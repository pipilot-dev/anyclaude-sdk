// Anthropic-compatible streaming chat client for browser-claude-sdk.
// Talks to the Anthropic Messages API (or any compatible endpoint). Browser-
// safe: relies only on the global `fetch`, `TextDecoder`, and `ReadableStream`.
//
// Reuses the SSE line reader from the OpenAI client. Anthropic emits both
// `event:` and `data:` lines per event, but every `data:` payload carries its
// own `type` field, so parsing the data JSON alone is sufficient.

import type {
  ChatMsg,
  ContentBlockParam,
  LLMClient,
  StreamResult,
  ToolCall,
  ToolDef,
} from '../types/index.js'
import { consumeSSE } from './openai.js'
import { parseInlineToolCalls } from './inlineTools.js'

export interface AnthropicClientOptions {
  apiKey?: string
  /** Base URL of the Anthropic-compatible API. Default: https://api.anthropic.com/v1 */
  baseUrl?: string
  /** Default model id. Can be overridden per call via streamChat opts. */
  model?: string
  /** Extra headers merged into every request. */
  headers?: Record<string, string>
  /** anthropic-version header. Default: '2023-06-01'. */
  anthropicVersion?: string
  /** Sampling temperature. */
  temperature?: number
  /** Max output tokens (required by the API). Default: 4096. */
  maxTokens?: number
}

/**
 * Creates an LLMClient backed by the Anthropic Messages API.
 *
 * Streams text deltas through `onToken` and surfaces tool calls (assembled
 * from streamed `input_json_delta` events) via the returned StreamResult and
 * the `onTool` hook.
 */
export function createAnthropicClient(options: AnthropicClientOptions = {}): LLMClient {
  const baseUrl = (options.baseUrl ?? 'https://api.anthropic.com/v1').replace(/\/$/, '')
  const defaultModel = options.model ?? 'claude-sonnet-4-6'
  const version = options.anthropicVersion ?? '2023-06-01'

  return {
    async streamChat(messages, opts): Promise<StreamResult> {
      const model = opts.model || defaultModel
      const { system, messages: anthropicMessages } = toAnthropicMessages(messages)

      const body: Record<string, unknown> = {
        model,
        max_tokens: options.maxTokens ?? 4096,
        messages: anthropicMessages,
        stream: true,
      }
      if (system) body.system = system
      if (options.temperature !== undefined) body.temperature = options.temperature
      if (opts.tools?.length) body.tools = opts.tools.map(toAnthropicTool)

      const res = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        signal: opts.signal,
        headers: {
          'content-type': 'application/json',
          'anthropic-version': version,
          'anthropic-dangerous-direct-browser-access': 'true',
          ...(options.apiKey ? { 'x-api-key': options.apiKey } : {}),
          ...options.headers,
        },
        body: JSON.stringify(body),
      })

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => res.statusText)
        throw new Error(`Anthropic request failed (${res.status}): ${errText}`)
      }

      let text = ''
      let inputTokens = 0
      let outputTokens = 0
      let cacheRead: number | undefined
      let cacheCreation: number | undefined
      let stopReason: import('../types/index.js').StopReason = null
      // Tool uses arrive as a content_block_start (with id/name) followed by a
      // sequence of input_json_delta partials. Accumulate by block index.
      const toolAcc = new Map<number, { id: string; name: string; json: string }>()

      await consumeSSE(res.body, (data) => {
        if (data === '[DONE]') return
        let event: AnthropicStreamEvent
        try {
          event = JSON.parse(data)
        } catch {
          return
        }

        // Usage: input tokens arrive on message_start, output on message_delta.
        if (event.type === 'message_start' && event.message?.usage) {
          inputTokens = event.message.usage.input_tokens ?? 0
          cacheRead = event.message.usage.cache_read_input_tokens ?? cacheRead
          cacheCreation = event.message.usage.cache_creation_input_tokens ?? cacheCreation
        }
        if (event.type === 'message_delta') {
          if (event.usage?.output_tokens != null) outputTokens = event.usage.output_tokens
          if (event.delta?.stop_reason) stopReason = mapStop(event.delta.stop_reason)
        }

        switch (event.type) {
          case 'content_block_start': {
            const block = event.content_block
            if (block?.type === 'tool_use') {
              toolAcc.set(event.index ?? 0, {
                id: block.id ?? '',
                name: block.name ?? '',
                json: '',
              })
            }
            break
          }
          case 'content_block_delta': {
            const delta = event.delta
            if (delta?.type === 'text_delta' && delta.text) {
              text += delta.text
              opts.onToken(delta.text)
            } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
              const cur = toolAcc.get(event.index ?? 0)
              if (cur) cur.json += delta.partial_json
            }
            break
          }
          default:
            // message_start / message_delta / message_stop / content_block_stop
            // / ping — nothing to accumulate.
            break
        }
      })

      const toolCalls: ToolCall[] = [...toolAcc.entries()]
        .sort(([a], [b]) => a - b)
        .map(([idx, t]) => ({
          id: t.id || `toolu_${idx}`,
          type: 'function' as const,
          // `json` is already a JSON-encoded object string; default to "{}".
          function: { name: t.name, arguments: t.json || '{}' },
        }))

      // Fallback: some relays/models emit tool calls as inline text rather than
      // native tool_use blocks. Parse them out and clean the visible text.
      let finalText = text
      if (!toolCalls.length) {
        const inline = parseInlineToolCalls(text)
        if (inline.calls.length) {
          toolCalls.push(...inline.calls)
          finalText = inline.cleanedText
        }
      }

      if (toolCalls.length && opts.onTool) opts.onTool(toolCalls)

      const usage: import('../types/index.js').Usage = {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheCreation,
      }
      return { text: finalText, toolCalls, model, usage, stopReason }
    },
  }
}

/** Map Anthropic stop_reason to our StopReason vocabulary. */
function mapStop(reason: string): import('../types/index.js').StopReason {
  switch (reason) {
    case 'end_turn':
    case 'max_tokens':
    case 'stop_sequence':
    case 'tool_use':
    case 'pause_turn':
    case 'refusal':
      return reason
    default:
      return 'end_turn'
  }
}

interface AnthropicStreamEvent {
  type: string
  index?: number
  content_block?: { type?: string; id?: string; name?: string }
  message?: {
    usage?: {
      input_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
  }
  usage?: { output_tokens?: number }
  delta?: {
    type?: string
    text?: string
    partial_json?: string
    stop_reason?: string
  }
}

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: unknown[]
}

/**
 * Convert our provider-neutral ChatMsg[] into the Anthropic Messages format:
 * leading system messages are hoisted into a top-level `system` string, and the
 * remaining messages are mapped to user/assistant turns with content blocks.
 */
function toAnthropicMessages(messages: ChatMsg[]): {
  system: string
  messages: AnthropicMessage[]
} {
  const systemParts: string[] = []
  const out: AnthropicMessage[] = []

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemParts.push(
        typeof msg.content === 'string' ? msg.content : blocksToText(msg.content),
      )
      continue
    }

    if (msg.role === 'tool') {
      // A tool result is delivered to Anthropic as a user message containing a
      // tool_result block keyed by the originating tool_use id.
      pushUserBlock(out, {
        type: 'tool_result',
        tool_use_id: msg.tool_call_id,
        content: typeof msg.content === 'string' ? msg.content : blocksToText(msg.content),
      })
      continue
    }

    if (msg.role === 'assistant') {
      const blocks: unknown[] = []
      const textContent =
        typeof msg.content === 'string' ? msg.content : blocksToText(msg.content)
      if (textContent) blocks.push({ type: 'text', text: textContent })
      if (msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: safeParseObject(tc.function.arguments),
          })
        }
      }
      out.push({ role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: '' }] })
      continue
    }

    // user
    out.push({ role: 'user', content: contentToAnthropicBlocks(msg.content) })
  }

  return { system: systemParts.join('\n\n'), messages: out }
}

/** Append a single block to a user message, coalescing with a trailing user turn. */
function pushUserBlock(out: AnthropicMessage[], block: unknown): void {
  const last = out[out.length - 1]
  if (last && last.role === 'user') {
    last.content.push(block)
  } else {
    out.push({ role: 'user', content: [block] })
  }
}

/** Map our content blocks to Anthropic content blocks. */
function contentToAnthropicBlocks(content: string | ContentBlockParam[]): unknown[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  const blocks: unknown[] = []
  for (const b of content) {
    if (b.type === 'text') {
      blocks.push({ type: 'text', text: b.text })
    } else if (b.type === 'image') {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: b.source.media_type, data: b.source.data },
      })
    } else if (b.type === 'document') {
      blocks.push({
        type: 'document',
        source: b.source,
        ...(b.title ? { title: b.title } : {}),
        ...(b.context ? { context: b.context } : {}),
      })
    } else if (b.type === 'tool_use') {
      blocks.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input })
    } else if (b.type === 'tool_result') {
      blocks.push({
        type: 'tool_result',
        tool_use_id: b.tool_use_id,
        content: typeof b.content === 'string' ? b.content : blocksToText(b.content),
        ...(b.is_error ? { is_error: true } : {}),
      })
    }
  }
  return blocks.length ? blocks : [{ type: 'text', text: '' }]
}

/** Convert an OpenAI-shape ToolDef into an Anthropic tool definition. */
function toAnthropicTool(tool: ToolDef): Record<string, unknown> {
  return {
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }
}

function blocksToText(blocks: ContentBlockParam[]): string {
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

function safeParseObject(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}
