// Anthropic Messages API <-> anyclaude-sdk bridge. This lets you stand up an
// Anthropic-compatible `/v1/messages` endpoint backed by ANY OpenAI-compatible
// model via the SDK's LLMClient + dialect recovery — i.e. a drop-in
// "claude-code-router": point Claude Code (or any Anthropic-Messages client) at
// your server via ANTHROPIC_BASE_URL, and it runs against DeepSeek / Qwen / GLM
// / Kimi / local Ollama, with inline tool-call dialects normalized back into
// proper Anthropic `tool_use` blocks so tool use actually works on cheap models.
//
// The CLIENT (Claude Code) runs the agent loop; this endpoint translates ONE
// turn per request: Anthropic request -> ChatMsg[] -> LLMClient.streamChat ->
// Anthropic response (JSON or SSE). It does NOT run anyclaude's own loop.
//
// Browser-clean (types + an LLMClient; no node:).
import type {
  ChatMsg,
  ContentBlockParam,
  ImageBlock,
  LLMClient,
  StopReason,
  StreamResult,
  ToolCall,
  ToolDef,
} from './types/index.js'
import { uuid } from './util/ids.js'

// ---------------------------------------------------------------------------
// Anthropic Messages request shapes (the subset Claude Code sends).
// ---------------------------------------------------------------------------
export interface AnthropicTextBlock {
  type: 'text'
  text: string
}
export interface AnthropicImageBlock {
  type: 'image'
  source:
    | { type: 'base64'; media_type: string; data: string }
    | { type: 'url'; url: string }
}
export interface AnthropicToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}
export interface AnthropicToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string | Array<{ type: string; text?: string; [k: string]: unknown }>
  is_error?: boolean
}
export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | { type: string; [k: string]: unknown }

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

export interface AnthropicMessagesRequest {
  model: string
  max_tokens?: number
  system?: string | Array<{ type: 'text'; text: string; [k: string]: unknown }>
  messages: AnthropicMessage[]
  tools?: Array<{ name: string; description?: string; input_schema: Record<string, unknown> }>
  tool_choice?: { type: 'auto' | 'any' | 'tool' | 'none'; name?: string }
  temperature?: number
  stream?: boolean
  [k: string]: unknown
}

/** The neutral request the SDK's LLMClient consumes. */
export interface ChatRequest {
  messages: ChatMsg[]
  tools: ToolDef[]
  model: string
  maxTokens?: number
  temperature?: number
  stream: boolean
}

// ---------------------------------------------------------------------------
// Request: Anthropic Messages -> ChatMsg[] + ToolDef[]
// ---------------------------------------------------------------------------

/** Convert Anthropic `tools` into the SDK's OpenAI-shape `ToolDef[]`. */
export function anthropicToolsToDefs(
  tools: AnthropicMessagesRequest['tools']
): ToolDef[] {
  if (!tools?.length) return []
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: (t.input_schema as ToolDef['function']['parameters']) ?? {
        type: 'object',
        properties: {},
      },
    },
  }))
}

function systemToText(system: AnthropicMessagesRequest['system']): string {
  if (!system) return ''
  if (typeof system === 'string') return system
  return system.map((b) => b.text ?? '').join('\n')
}

function anthropicImageToBlock(b: AnthropicImageBlock): ImageBlock | null {
  if (b.source.type === 'base64') {
    return { type: 'image', source: { type: 'base64', media_type: b.source.media_type, data: b.source.data } }
  }
  // URL images — pass through as a text marker; most OpenAI-compatible chat
  // endpoints want a data URL, which we don't have here.
  return null
}

function resultBlockToText(
  content: AnthropicToolResultBlock['content']
): string {
  if (typeof content === 'string') return content
  return content
    .map((c) => (c.type === 'text' ? (c.text ?? '') : JSON.stringify(c)))
    .filter(Boolean)
    .join('\n')
}

/**
 * Convert an Anthropic Messages request into the neutral `ChatRequest` the SDK
 * consumes. Anthropic packs `tool_result` blocks inside user messages; we split
 * them into separate `tool` ChatMsgs (OpenAI shape). `tool_use` blocks on an
 * assistant message become `tool_calls`.
 */
export function anthropicToChat(body: AnthropicMessagesRequest): ChatRequest {
  const messages: ChatMsg[] = []
  const system = systemToText(body.system)
  if (system) messages.push({ role: 'system', content: system })

  for (const msg of body.messages) {
    if (typeof msg.content === 'string') {
      messages.push({ role: msg.role, content: msg.content })
      continue
    }

    if (msg.role === 'assistant') {
      const textParts: string[] = []
      const toolCalls: ToolCall[] = []
      for (const b of msg.content) {
        if (b.type === 'text') textParts.push((b as AnthropicTextBlock).text)
        else if (b.type === 'tool_use') {
          const tu = b as AnthropicToolUseBlock
          toolCalls.push({
            id: tu.id,
            type: 'function',
            function: { name: tu.name, arguments: JSON.stringify(tu.input ?? {}) },
          })
        }
      }
      messages.push({
        role: 'assistant',
        content: textParts.join('\n'),
        tool_calls: toolCalls.length ? toolCalls : undefined,
      })
      continue
    }

    // user: tool_result blocks become separate `tool` msgs; remaining
    // text/image content becomes a user msg (after the tool results).
    const userBlocks: ContentBlockParam[] = []
    for (const b of msg.content) {
      if (b.type === 'tool_result') {
        const tr = b as AnthropicToolResultBlock
        messages.push({
          role: 'tool',
          tool_call_id: tr.tool_use_id,
          content: resultBlockToText(tr.content),
        })
      } else if (b.type === 'text') {
        userBlocks.push({ type: 'text', text: (b as AnthropicTextBlock).text })
      } else if (b.type === 'image') {
        const img = anthropicImageToBlock(b as AnthropicImageBlock)
        if (img) userBlocks.push(img)
      }
    }
    if (userBlocks.length) {
      const onlyText = userBlocks.length === 1 && userBlocks[0].type === 'text'
      messages.push({
        role: 'user',
        content: onlyText ? (userBlocks[0] as { text: string }).text : userBlocks,
      })
    }
  }

  return {
    messages,
    tools: anthropicToolsToDefs(body.tools),
    model: body.model,
    maxTokens: body.max_tokens,
    temperature: body.temperature,
    stream: !!body.stream,
  }
}

// ---------------------------------------------------------------------------
// Response: StreamResult -> Anthropic Message (non-streaming)
// ---------------------------------------------------------------------------

function mapStopReason(reason: StopReason, hasTools: boolean): string {
  if (hasTools) return 'tool_use'
  switch (reason) {
    case 'max_tokens':
      return 'max_tokens'
    case 'tool_use':
      return 'tool_use'
    default:
      return 'end_turn'
  }
}

function safeJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s || '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

/** Build a non-streaming Anthropic Messages response object from a StreamResult. */
export function streamResultToAnthropicMessage(
  result: StreamResult,
  opts: { model: string; id?: string }
): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = []
  if (result.text) content.push({ type: 'text', text: result.text })
  for (const tc of result.toolCalls) {
    content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: safeJson(tc.function.arguments) })
  }
  return {
    id: opts.id ?? 'msg_' + uuid().replace(/-/g, '').slice(0, 24),
    type: 'message',
    role: 'assistant',
    model: opts.model,
    content,
    stop_reason: mapStopReason(result.stopReason ?? null, result.toolCalls.length > 0),
    stop_sequence: null,
    usage: {
      input_tokens: result.usage?.input_tokens ?? 0,
      output_tokens: result.usage?.output_tokens ?? 0,
      cache_read_input_tokens: result.usage?.cache_read_input_tokens ?? 0,
    },
  }
}

// ---------------------------------------------------------------------------
// Response: run the LLM and emit the Anthropic SSE event sequence.
// ---------------------------------------------------------------------------

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

/**
 * Run a turn through `llm` and yield the Anthropic Messages **SSE** event
 * sequence as strings (message_start -> content_block_* -> message_delta ->
 * message_stop). Text streams live; tool calls (native or dialect-recovered)
 * are emitted as `tool_use` blocks with a single `input_json_delta`. Pipe the
 * yielded strings straight to an HTTP response body.
 */
export async function* anthropicSSE(
  llm: LLMClient,
  req: ChatRequest,
  opts: { model: string; signal?: AbortSignal; id?: string } = { model: '' }
): AsyncGenerator<string> {
  const model = opts.model || req.model
  const msgId = opts.id ?? 'msg_' + uuid().replace(/-/g, '').slice(0, 24)

  yield sse('message_start', {
    type: 'message_start',
    message: {
      id: msgId,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  })

  // Live text streaming with a push queue; suppress tokens once inline
  // tool-call markup begins (the dialect parser recovers the call from the
  // final result instead — we don't want raw <tool_call> markup as text).
  const queue: string[] = []
  let resolveNext: (() => void) | null = null
  let streamedText = ''
  let inToolMarkup = false
  let textOpen = false
  let nextIndex = 0
  let textIndex = 0

  const push = (s: string) => {
    queue.push(s)
    resolveNext?.()
    resolveNext = null
  }

  const sp = llm.streamChat(req.messages, {
    model,
    tools: req.tools.length ? req.tools : undefined,
    signal: opts.signal,
    onToken: (delta) => {
      streamedText += delta
      if (!inToolMarkup && /<tool_call|<function\s*=/.test(streamedText)) inToolMarkup = true
      if (inToolMarkup) return
      if (!textOpen) {
        textOpen = true
        textIndex = nextIndex++
        push(sse('content_block_start', { type: 'content_block_start', index: textIndex, content_block: { type: 'text', text: '' } }))
      }
      push(sse('content_block_delta', { type: 'content_block_delta', index: textIndex, delta: { type: 'text_delta', text: delta } }))
    },
  })

  let result: StreamResult | undefined
  let done = false
  sp.then(
    (r) => {
      result = r
    },
    () => {}
  ).finally(() => {
    done = true
    resolveNext?.()
    resolveNext = null
  })

  // Drain text deltas as they arrive.
  while (!done || queue.length) {
    if (queue.length) {
      yield queue.shift() as string
      continue
    }
    await new Promise<void>((res) => (resolveNext = res))
  }

  result = await sp.catch(() => undefined)
  if (textOpen) {
    yield sse('content_block_stop', { type: 'content_block_stop', index: textIndex })
  }

  const toolCalls = result?.toolCalls ?? []
  for (const tc of toolCalls) {
    const idx = nextIndex++
    yield sse('content_block_start', {
      type: 'content_block_start',
      index: idx,
      content_block: { type: 'tool_use', id: tc.id, name: tc.function.name, input: {} },
    })
    yield sse('content_block_delta', {
      type: 'content_block_delta',
      index: idx,
      delta: { type: 'input_json_delta', partial_json: tc.function.arguments || '{}' },
    })
    yield sse('content_block_stop', { type: 'content_block_stop', index: idx })
  }

  yield sse('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: mapStopReason(result?.stopReason ?? null, toolCalls.length > 0), stop_sequence: null },
    usage: { output_tokens: result?.usage?.output_tokens ?? 0 },
  })
  yield sse('message_stop', { type: 'message_stop' })
}
