import type {
  ChatMsg,
  ContentBlockParam,
  LLMClient,
  StreamResult,
  ToolCall,
  ToolDef,
} from '../types/index.js'
import { parseInlineToolCalls } from './inlineTools.js'

export interface OpenAIClientOptions {
  /** API key, or a function returning one per request (for round-robin key pools). */
  apiKey?: string | (() => string | undefined)
  /** Base URL of the OpenAI-compatible API. Default: https://api.openai.com/v1 */
  baseUrl?: string
  /** Default model id. Can be overridden per call via streamChat opts. */
  model?: string
  /** Extra headers (e.g. for Groq, OpenRouter, Together). */
  headers?: Record<string, string>
  /** Sampling temperature. */
  temperature?: number
  /** Max output tokens. */
  maxTokens?: number
  /** Reasoning effort ('none'|'low'|'high'…) → sets `reasoning_effort` (reasoning models). */
  reasoningEffort?: string
  /** Allow the model to batch multiple tool calls → sets `parallel_tool_calls` (when tools present). */
  parallelToolCalls?: boolean
}

/**
 * Creates an LLMClient backed by any OpenAI-compatible /chat/completions
 * endpoint (OpenAI, Groq, Together, OpenRouter, local llama.cpp, etc.).
 *
 * Streams text deltas through `onToken` and surfaces tool calls (assembled
 * from streamed deltas) via the returned StreamResult and the `onTool` hook.
 */
export function createOpenAIClient(options: OpenAIClientOptions = {}): LLMClient {
  const baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')
  const defaultModel = options.model ?? 'gpt-4o'

  return {
    async streamChat(messages, opts): Promise<StreamResult> {
      const model = opts.model || defaultModel
      const body: Record<string, unknown> = {
        model,
        messages: messages.map(toOpenAIMessage),
        stream: true,
        stream_options: { include_usage: true },
      }
      if (options.temperature !== undefined) body.temperature = options.temperature
      if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens
      // Reasoning models (e.g. xAI grok-4.x): 'none' → 0 reasoning tokens (cheaper/faster).
      if (options.reasoningEffort) body.reasoning_effort = options.reasoningEffort
      if (opts.tools?.length) {
        body.tools = opts.tools
        body.tool_choice = 'auto'
        if (options.parallelToolCalls !== undefined) body.parallel_tool_calls = options.parallelToolCalls
      }

      const apiKey = typeof options.apiKey === 'function' ? options.apiKey() : options.apiKey
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...options.headers,
      }
      if (apiKey) headers.authorization = `Bearer ${apiKey}`

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal: opts.signal,
        headers,
        body: JSON.stringify(body),
      })

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => res.statusText)
        throw new Error(`LLM request failed (${res.status}): ${errText}`)
      }

      let text = ''
      let usage: import('../types/index.js').Usage | undefined
      let finishReason: string | null = null
      const toolAcc = new Map<number, { id: string; name: string; args: string }>()

      await consumeSSE(res.body, (data) => {
        if (data === '[DONE]') return
        let chunk: OpenAIStreamChunk
        try {
          chunk = JSON.parse(data)
        } catch {
          return
        }
        // The final usage chunk (stream_options.include_usage) has empty choices.
        if (chunk.usage) {
          usage = {
            input_tokens: chunk.usage.prompt_tokens ?? 0,
            output_tokens: chunk.usage.completion_tokens ?? 0,
            cache_read_input_tokens: chunk.usage.prompt_tokens_details?.cached_tokens,
          }
        }
        const choice = chunk.choices?.[0]
        if (choice?.finish_reason) finishReason = choice.finish_reason
        const delta = choice?.delta
        if (!delta) return

        if (typeof delta.content === 'string' && delta.content) {
          text += delta.content
          opts.onToken(delta.content)
        }
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0
            const cur = toolAcc.get(idx) ?? { id: '', name: '', args: '' }
            if (tc.id) cur.id = tc.id
            if (tc.function?.name) cur.name = tc.function.name
            if (tc.function?.arguments) cur.args += tc.function.arguments
            toolAcc.set(idx, cur)
          }
        }
      })

      const toolCalls: ToolCall[] = [...toolAcc.entries()]
        .sort(([a], [b]) => a - b)
        .map(([idx, t]) => ({
          id: t.id || `call_${idx}`,
          type: 'function' as const,
          function: { name: t.name, arguments: t.args || '{}' },
        }))

      // Fallback: some endpoints emit tool calls as inline text rather than
      // native tool_calls. Parse them out and clean the visible text.
      let finalText = text
      if (!toolCalls.length) {
        const inline = parseInlineToolCalls(text)
        if (inline.calls.length) {
          toolCalls.push(...inline.calls)
          finalText = inline.cleanedText
        }
      }

      if (toolCalls.length && opts.onTool) opts.onTool(toolCalls)

      return { text: finalText, toolCalls, model, usage, stopReason: mapFinishReason(finishReason) }
    },
  }
}

/** Map OpenAI finish_reason to our StopReason vocabulary. */
function mapFinishReason(
  reason: string | null
): import('../types/index.js').StopReason {
  switch (reason) {
    case 'stop':
      return 'end_turn'
    case 'length':
      return 'max_tokens'
    case 'tool_calls':
    case 'function_call':
      return 'tool_use'
    default:
      return reason ? 'end_turn' : null
  }
}

interface OpenAIStreamChunk {
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
  }
  choices?: Array<{
    delta?: {
      content?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
}

/** A single message in OpenAI `/chat/completions` wire shape. */
export type OpenAIChatMessage = Record<string, unknown>

/**
 * Convert the SDK's provider-neutral `ChatMsg[]` into OpenAI `/chat/completions`
 * `messages`. Exported so custom `LLMClient` authors who bring their own
 * transport (proxy, encryption, alternate URL) can reuse the SDK's canonical
 * wire conversion instead of forking it — keeping content-block mapping
 * (text / image / PDF `document` / `tool_result`) in lockstep with the
 * built-in `createOpenAIClient`.
 */
export function toOpenAIMessages(messages: ChatMsg[]): OpenAIChatMessage[] {
  return messages.map(toOpenAIMessage)
}

/** Convert our provider-neutral ChatMsg into an OpenAI chat message. */
export function toOpenAIMessage(msg: ChatMsg): OpenAIChatMessage {
  if (msg.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: msg.tool_call_id,
      content: typeof msg.content === 'string' ? msg.content : blocksToText(msg.content),
    }
  }
  if (msg.role === 'assistant') {
    const out: Record<string, unknown> = {
      role: 'assistant',
      content: typeof msg.content === 'string' ? msg.content : blocksToText(msg.content),
    }
    if (msg.tool_calls?.length) out.tool_calls = msg.tool_calls
    return out
  }
  // system / user
  if (typeof msg.content === 'string') {
    return { role: msg.role, content: msg.content }
  }
  return { role: msg.role, content: blocksToOpenAIContent(msg.content) }
}

/**
 * Map content blocks to OpenAI multimodal `content` parts
 * (`text` / `image_url` / `file`). Exported for custom `LLMClient` authors.
 */
export function blocksToOpenAIContent(blocks: ContentBlockParam[]): unknown {
  const parts: unknown[] = []
  for (const b of blocks) {
    if (b.type === 'text') parts.push({ type: 'text', text: b.text })
    else if (b.type === 'image') {
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` },
      })
    } else if (b.type === 'document') {
      // OpenAI chat completions has no portable inline-PDF part; some gateways
      // accept a `file` part. Emit that when we have base64 PDF data, plus a
      // text marker so non-supporting models still get a hint.
      if (b.source.type === 'base64') {
        parts.push({
          type: 'file',
          file: {
            filename: b.title ?? 'document.pdf',
            file_data: `data:application/pdf;base64,${b.source.data}`,
          },
        })
      } else {
        parts.push({ type: 'text', text: b.source.data })
      }
    }
  }
  return parts.length ? parts : ''
}

/**
 * Flatten `text` + nested `tool_result` content blocks to a plain string
 * (used for `assistant`/`tool` roles). Exported for custom `LLMClient` authors.
 */
export function blocksToText(blocks: ContentBlockParam[]): string {
  return blocks
    .map((b) => {
      if (b.type === 'text') return b.text
      if (b.type === 'tool_result')
        return typeof b.content === 'string' ? b.content : blocksToText(b.content)
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

/** Read an SSE response body, invoking `onData` for each `data:` payload. */
export async function consumeSSE(
  body: ReadableStream<Uint8Array>,
  onData: (data: string) => void
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (line.startsWith('data:')) onData(line.slice(5).trim())
      }
    }
  } finally {
    reader.releaseLock?.()
  }
}
