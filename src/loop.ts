// runToolLoop — the bare in-process agent tool loop, extracted as a standalone,
// drop-in primitive. It is the core cycle that powers query():
//
//   call the LLM → parse tool calls → execute them against `ctx` → append
//   results → repeat until the model stops (no tool calls) or maxTurns.
//
// It yields the SAME SDKMessage shapes as query() (assistant / stream_event /
// synthetic user tool_result / result), so anyclaude-react renders it unchanged.
//
// This is intentionally bare: no sessions, survivor/clientTools pause, MCP,
// sub-agents, background tasks, message queue, hooks, plan mode, or
// auto-compaction. Bring those yourself, or use query() for the batteries-
// included engine. Browser-clean (types + browser-safe modules only).
import type {
  APIAssistantMessage,
  CanUseTool,
  ChatMsg,
  ContentBlockParam,
  DocumentBlock,
  ImageBlock,
  LLMClient,
  SDKMessage,
  StopReason,
  TextBlock,
  ToolCall,
  ToolUseBlock,
  Usage,
} from './types/index.js'
import type { Tool, ToolContext } from './tools/types.js'
import { toolByName, toolDefs } from './tools/index.js'
import { validateToolArguments } from './llm/repair.js'
import { parseToolCalls } from './llm/dialects.js'
import { uuid } from './util/ids.js'

export interface RunToolLoopOptions {
  /** Conversation so far: `[systemMsg, ...]`. Mutated in place as the loop appends turns. */
  history: ChatMsg[]
  /** Tools the model may call (executed via `ctx`). */
  tools: Tool[]
  /** Any OpenAI/Anthropic-compatible client. */
  llm: LLMClient
  model?: string
  /** Tool-execution context (fs / exec / cwd / readFiles / limits …). */
  ctx: ToolContext
  /** Max LLM turns before stopping with `error_max_turns`. Default 50. */
  maxTurns?: number
  signal?: AbortSignal
  /** Optional permission gate; a `deny` result turns into an error tool_result. */
  canUseTool?: CanUseTool
  /** Tool names to DELEGATE to the host instead of running via `ctx` (inline). A
   *  tool with no `run` is auto-delegated too (Vercel-style "no execute = client"). */
  clientTools?: string[]
  /** Executor for delegated tools — runs the call (e.g. on a browser WebContainer)
   *  and returns the result inline. Required if any tool is delegated. */
  onClientTool?: (req: {
    tool_use_id: string
    name: string
    input: Record<string, unknown>
  }) => Promise<{ content: unknown; is_error?: boolean }> | { content: unknown; is_error?: boolean }
  /** Emit `stream_event` text deltas as the assistant streams. */
  includePartialMessages?: boolean
  /** Correlation id stamped on every emitted SDKMessage. */
  sessionId?: string
  /**
   * Validate tool arguments before executing; on malformed/incomplete JSON,
   * feed the model a corrective `is_error` tool_result (with the expected
   * schema) instead of running the tool with garbage, so it self-heals.
   * Default `true`. Set `false` to pass raw args straight through.
   */
  repairToolCalls?: boolean
}

/** Regex that matches the onset of tool-call / reasoning markup in streamed text. */
function buildSuppressRe(toolNames: string[]): RegExp {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const names = toolNames.filter(Boolean).map(esc)
  const named = names.length ? `|<(?:${names.join('|')})[\\s/>]` : ''
  return new RegExp(`<tool_call|<function\\s*=|<thinking${named}`, 'i')
}

const emptyUsage = (): Usage => ({ input_tokens: 0, output_tokens: 0 })
function addUsage(t: Usage, b?: Usage): void {
  if (!b) return
  t.input_tokens += b.input_tokens || 0
  t.output_tokens += b.output_tokens || 0
  t.cache_read_input_tokens = (t.cache_read_input_tokens || 0) + (b.cache_read_input_tokens || 0)
  t.cache_creation_input_tokens = (t.cache_creation_input_tokens || 0) + (b.cache_creation_input_tokens || 0)
}
function safeParse(json: string): Record<string, unknown> {
  if (!json || !json.trim()) return {}
  try {
    const v = JSON.parse(json)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : { value: v }
  } catch {
    return { _raw: json }
  }
}
function toolUseBlocks(calls: ToolCall[]): ToolUseBlock[] {
  return calls.map((c) => ({ type: 'tool_use', id: c.id, name: c.function.name, input: safeParse(c.function.arguments) }))
}
function resultToText(content: string | ContentBlockParam[]): string {
  if (typeof content === 'string') return content
  return content
    .map((b) => (b.type === 'text' ? b.text : b.type === 'image' ? '[image]' : b.type === 'document' ? '[document]' : `[${b.type}]`))
    .join('\n')
}
function toToolResultContent(
  content: string | ContentBlockParam[]
): string | Array<TextBlock | ImageBlock | DocumentBlock> {
  if (typeof content === 'string') return content
  return content.filter((b) => b.type === 'text' || b.type === 'image' || b.type === 'document') as Array<
    TextBlock | ImageBlock | DocumentBlock
  >
}
function createPushQueue<T>() {
  const items: T[] = []
  let resolveNext: ((r: IteratorResult<T>) => void) | null = null
  let closed = false
  return {
    push(v: T) {
      if (resolveNext) {
        resolveNext({ value: v, done: false })
        resolveNext = null
      } else items.push(v)
    },
    close() {
      closed = true
      if (resolveNext) {
        resolveNext({ value: undefined as unknown as T, done: true })
        resolveNext = null
      }
    },
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next: (): Promise<IteratorResult<T>> => {
          if (items.length) return Promise.resolve({ value: items.shift() as T, done: false })
          if (closed) return Promise.resolve({ value: undefined as unknown as T, done: true })
          return new Promise((res) => (resolveNext = res))
        },
      }
    },
  }
}

/**
 * Run the bare tool loop, yielding SDKMessages until the model stops or maxTurns.
 *
 *   const ctx = { fs, exec, cwd: '/work', readFiles: new Set() } as ToolContext
 *   for await (const m of runToolLoop({ history, tools, llm, model, ctx })) render(m)
 */
export async function* runToolLoop(opts: RunToolLoopOptions): AsyncGenerator<SDKMessage> {
  const { history, llm, model, ctx, signal, canUseTool, onClientTool } = opts
  const tools = opts.tools
  const clientTools = new Set(opts.clientTools ?? [])
  const repair = opts.repairToolCalls !== false
  const maxTurns = opts.maxTurns ?? 50
  const sessionId = opts.sessionId ?? uuid()
  const emitPartial = !!opts.includePartialMessages
  const byName = toolByName(tools)
  const defs = toolDefs(tools)
  // Stop streaming visible deltas once tool-call / reasoning markup begins — the
  // final cleaned text comes from the parsed result. Covers native dialects,
  // <thinking>, and named-tag tools (e.g. <finish>) so they never flicker to the UI.
  const suppressRe = buildSuppressRe(defs.map((d) => d.function.name))

  const startedAt = Date.now()
  let apiMs = 0
  let turns = 0
  let lastText = ''
  let resultModel = model ?? 'unknown'
  let hitMaxTurns = false
  let errored: string | null = null
  const usageTotal = emptyUsage()

  while (true) {
    if (signal?.aborted) break
    if (turns >= maxTurns) {
      hitMaxTurns = true
      break
    }
    turns++

    let streamedText = ''
    let captured: ToolCall[] = []
    const apiStart = Date.now()
    let result
    try {
      if (emitPartial) {
        const q = createPushQueue<SDKMessage>()
        let inToolMarkup = false
        const sp = llm.streamChat(history, {
          model,
          tools: defs,
          signal,
          onToken: (delta) => {
            streamedText += delta
            if (!inToolMarkup && suppressRe.test(streamedText)) inToolMarkup = true
            if (inToolMarkup) return
            q.push({
              type: 'stream_event',
              event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: delta } },
              parent_tool_use_id: null,
              uuid: uuid(),
              session_id: sessionId,
            })
          },
          onTool: (calls) => {
            captured = calls
          },
        })
        sp.then(() => {}, () => {}).finally(() => q.close())
        for await (const ev of q) yield ev
        result = await sp
      } else {
        result = await llm.streamChat(history, {
          model,
          tools: defs,
          signal,
          onToken: (delta) => {
            streamedText += delta
          },
          onTool: (calls) => {
            captured = calls
          },
        })
      }
    } catch (err) {
      errored = err instanceof Error ? err.message : String(err)
      break
    }
    apiMs += Date.now() - apiStart

    let text = result.text || streamedText
    let calls = result.toolCalls.length ? result.toolCalls : captured
    // Loop-level safety net: recover tool calls a (possibly custom) LLMClient left
    // as inline text — native dialects + named-tag tools — and scrub leaked
    // tool/reasoning markup so it never renders. Runs for ANY client, not just ours.
    if (!calls.length) {
      const recovered = parseToolCalls(text, { toolNames: defs.map((d) => d.function.name) })
      if (recovered.calls.length) calls = recovered.calls
      text = recovered.cleanedText
    }
    lastText = text || lastText
    resultModel = result.model || resultModel
    addUsage(usageTotal, result.usage)

    const stopReason: StopReason = calls.length ? 'tool_use' : result.stopReason ?? 'end_turn'
    const assistantContent: ContentBlockParam[] = []
    if (text) assistantContent.push({ type: 'text', text })
    assistantContent.push(...toolUseBlocks(calls))

    const apiAssistant: APIAssistantMessage = {
      id: 'msg_' + uuid().replace(/-/g, '').slice(0, 24),
      type: 'message',
      role: 'assistant',
      model: resultModel,
      content: assistantContent,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: result.usage ?? emptyUsage(),
    }
    yield { type: 'assistant', message: apiAssistant, parent_tool_use_id: null, uuid: uuid(), session_id: sessionId }
    history.push({ role: 'assistant', content: text, tool_calls: calls.length ? calls : undefined })

    if (!calls.length) break

    const toolResultBlocks: ContentBlockParam[] = []
    const turnMedia: Array<ImageBlock | DocumentBlock> = []
    for (const call of calls) {
      if (signal?.aborted) break
      const name = call.function.name
      let input = safeParse(call.function.arguments)
      const tool = byName.get(name)
      let content: string | ContentBlockParam[] = ''
      let isError = false

      // Repair: validate args against the tool's schema before running. On a
      // malformed/incomplete call, hand the model a corrective tool_result so
      // it retries with valid JSON instead of executing with garbage.
      const check = repair && tool ? validateToolArguments(tool.def, call.function.arguments) : null
      if (check && !check.ok) {
        content = check.error!
        isError = true
      } else {
      if (check) input = check.input

      // Delegated tool (listed in clientTools, or has no `run`): execute on the
      // host via onClientTool instead of `ctx` — never touches the server FS.
      const delegated = clientTools.has(name) || (tool != null && !tool.run)
      if (delegated) {
        if (!onClientTool) {
          content = `No client executor for "${name}" (delegated tool; pass onClientTool).`
          isError = true
        } else {
          try {
            const r = await onClientTool({ tool_use_id: call.id, name, input })
            content = (typeof r.content === 'string' ? r.content : JSON.stringify(r.content ?? '')) as string
            isError = !!r.is_error
          } catch (err) {
            content = `Error (client) ${name}: ${err instanceof Error ? err.message : String(err)}`
            isError = true
          }
        }
      } else if (!tool) {
        content = `Error: unknown tool "${name}"`
        isError = true
      } else {
        const decision = canUseTool
          ? await canUseTool(name, input, { signal, toolUseId: call.id })
          : { behavior: 'allow' as const }
        if (decision.behavior === 'deny') {
          content = `Permission denied: ${decision.message}`
          isError = true
        } else {
          if ('updatedInput' in decision && decision.updatedInput) input = decision.updatedInput
          try {
            const r = await tool.run!(input, ctx)
            content = r.content
            isError = !!r.isError
          } catch (err) {
            content = `Error executing ${name}: ${err instanceof Error ? err.message : String(err)}`
            isError = true
          }
        }
      }
      }

      const textOut = resultToText(content)
      history.push({ role: 'tool', tool_call_id: call.id, content: textOut })
      if (Array.isArray(content)) {
        for (const b of content) if (b.type === 'image' || b.type === 'document') turnMedia.push(b)
      }
      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: typeof content === 'string' ? textOut : toToolResultContent(content),
        is_error: isError || undefined,
      })
    }

    if (turnMedia.length) {
      history.push({
        role: 'user',
        content: [{ type: 'text', text: 'Attached file content from the tools above:' }, ...turnMedia],
      })
    }
    if (toolResultBlocks.length) {
      yield {
        type: 'user',
        message: { role: 'user', content: toolResultBlocks },
        parent_tool_use_id: null,
        isSynthetic: true,
        timestamp: new Date().toISOString(),
        uuid: uuid(),
        session_id: sessionId,
      }
    }
  }

  const durationMs = Date.now() - startedAt
  if (errored || hitMaxTurns) {
    yield {
      type: 'result',
      subtype: hitMaxTurns ? 'error_max_turns' : 'error_during_execution',
      duration_ms: durationMs,
      duration_api_ms: apiMs,
      is_error: true,
      num_turns: turns,
      stop_reason: hitMaxTurns ? 'max_turns' : 'error',
      total_cost_usd: 0,
      usage: usageTotal,
      modelUsage: {},
      permission_denials: [],
      errors: errored ? [errored] : [`Reached max turns (${maxTurns})`],
      uuid: uuid(),
      session_id: sessionId,
    }
  } else {
    yield {
      type: 'result',
      subtype: 'success',
      duration_ms: durationMs,
      duration_api_ms: apiMs,
      is_error: false,
      num_turns: turns,
      result: lastText,
      stop_reason: 'end_turn',
      total_cost_usd: 0,
      usage: usageTotal,
      modelUsage: {},
      permission_denials: [],
      uuid: uuid(),
      session_id: sessionId,
    }
  }
}
