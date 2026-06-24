// OpenAI Responses API client (POST /v1/responses).
//
// The Responses API differs from Chat Completions:
//   - System text goes in `instructions`; the conversation is an `input` array
//     of typed items (messages, function_call, function_call_output).
//   - Tools are flat: { type:'function', name, description, parameters }.
//   - Streaming is a typed SSE event stream: response.output_text.delta,
//     response.function_call_arguments.delta, response.output_item.added,
//     response.completed, etc.
//
// We normalize all of that to our provider-neutral LLMClient interface.

import type {
  ChatMsg,
  ContentBlockParam,
  LLMClient,
  StopReason,
  StreamResult,
  ToolCall,
  ToolDef,
  Usage,
} from '../types/index.js'
import { consumeSSE } from './openai.js'
import { parseInlineToolCalls } from './inlineTools.js'

export interface ResponsesClientOptions {
  apiKey?: string
  /** Base URL of the Responses-compatible API. Default: https://api.openai.com/v1 */
  baseUrl?: string
  model?: string
  headers?: Record<string, string>
  temperature?: number
  /** Max output tokens (maps to `max_output_tokens`). */
  maxTokens?: number
  /** Whether the server should persist state. Default false (we send full history). */
  store?: boolean
}

/**
 * Creates an LLMClient backed by the OpenAI Responses API (or any
 * Responses-compatible endpoint).
 */
export function createResponsesClient(options: ResponsesClientOptions = {}): LLMClient {
  const baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')
  const defaultModel = options.model ?? 'gpt-4o'

  return {
    async streamChat(messages, opts): Promise<StreamResult> {
      const model = opts.model || defaultModel
      const { instructions, input } = toResponsesInput(messages)

      const body: Record<string, unknown> = {
        model,
        input,
        stream: true,
        store: options.store ?? false,
      }
      if (instructions) body.instructions = instructions
      if (options.temperature !== undefined) body.temperature = options.temperature
      if (options.maxTokens !== undefined) body.max_output_tokens = options.maxTokens
      if (opts.tools?.length) {
        body.tools = opts.tools.map(toResponsesTool)
        body.tool_choice = 'auto'
      }

      const res = await fetch(`${baseUrl}/responses`, {
        method: 'POST',
        signal: opts.signal,
        headers: {
          'content-type': 'application/json',
          ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
          ...options.headers,
        },
        body: JSON.stringify(body),
      })

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => res.statusText)
        throw new Error(`Responses request failed (${res.status}): ${errText}`)
      }

      let text = ''
      let usage: Usage | undefined
      let status: string | null = null
      // Function calls stream as output items keyed by output_index.
      const toolAcc = new Map<number, { callId: string; name: string; args: string }>()

      await consumeSSE(res.body, (data) => {
        if (data === '[DONE]') return
        let ev: ResponsesEvent
        try {
          ev = JSON.parse(data)
        } catch {
          return
        }

        switch (ev.type) {
          case 'response.output_text.delta': {
            if (typeof ev.delta === 'string' && ev.delta) {
              text += ev.delta
              opts.onToken(ev.delta)
            }
            break
          }
          case 'response.output_item.added': {
            const item = ev.item
            if (item?.type === 'function_call') {
              toolAcc.set(ev.output_index ?? toolAcc.size, {
                callId: item.call_id ?? item.id ?? '',
                name: item.name ?? '',
                args: typeof item.arguments === 'string' ? item.arguments : '',
              })
            }
            break
          }
          case 'response.function_call_arguments.delta': {
            const cur = toolAcc.get(ev.output_index ?? 0)
            if (cur && typeof ev.delta === 'string') cur.args += ev.delta
            break
          }
          case 'response.output_item.done': {
            // Finalize args/name/call_id from the completed item.
            const item = ev.item
            if (item?.type === 'function_call') {
              const cur = toolAcc.get(ev.output_index ?? 0)
              if (cur) {
                if (item.call_id) cur.callId = item.call_id
                if (item.name) cur.name = item.name
                if (typeof item.arguments === 'string' && item.arguments) cur.args = item.arguments
              }
            }
            break
          }
          case 'response.completed':
          case 'response.incomplete':
          case 'response.failed': {
            const r = ev.response
            if (r?.usage) {
              usage = {
                input_tokens: r.usage.input_tokens ?? 0,
                output_tokens: r.usage.output_tokens ?? 0,
                cache_read_input_tokens: r.usage.input_tokens_details?.cached_tokens,
              }
            }
            status = r?.status ?? null
            break
          }
          default:
            break
        }
      })

      let toolCalls: ToolCall[] = [...toolAcc.entries()]
        .sort(([a], [b]) => a - b)
        .map(([idx, t]) => ({
          id: t.callId || `call_${idx}`,
          type: 'function' as const,
          function: { name: t.name, arguments: t.args || '{}' },
        }))

      let finalText = text
      if (!toolCalls.length) {
        const inline = parseInlineToolCalls(text)
        if (inline.calls.length) {
          toolCalls = inline.calls
          finalText = inline.cleanedText
        }
      }

      if (toolCalls.length && opts.onTool) opts.onTool(toolCalls)

      const stopReason: StopReason = toolCalls.length
        ? 'tool_use'
        : status === 'incomplete'
          ? 'max_tokens'
          : 'end_turn'

      return { text: finalText, toolCalls, model, usage, stopReason }
    },
  }
}

interface ResponsesEvent {
  type: string
  delta?: string
  output_index?: number
  item?: {
    type?: string
    id?: string
    call_id?: string
    name?: string
    arguments?: string
  }
  response?: {
    status?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      input_tokens_details?: { cached_tokens?: number }
    }
  }
}

/** Convert our ChatMsg[] into Responses `instructions` + `input` items. */
function toResponsesInput(messages: ChatMsg[]): {
  instructions: string
  input: unknown[]
} {
  const instructions: string[] = []
  const input: unknown[] = []

  for (const msg of messages) {
    if (msg.role === 'system') {
      instructions.push(typeof msg.content === 'string' ? msg.content : blocksToText(msg.content))
      continue
    }

    if (msg.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: msg.tool_call_id,
        output: typeof msg.content === 'string' ? msg.content : blocksToText(msg.content),
      })
      continue
    }

    if (msg.role === 'assistant') {
      const textContent =
        typeof msg.content === 'string' ? msg.content : blocksToText(msg.content)
      if (textContent) {
        input.push({
          role: 'assistant',
          content: [{ type: 'output_text', text: textContent }],
        })
      }
      if (msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          input.push({
            type: 'function_call',
            call_id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments || '{}',
          })
        }
      }
      continue
    }

    // user
    if (typeof msg.content === 'string') {
      input.push({ role: 'user', content: [{ type: 'input_text', text: msg.content }] })
    } else {
      input.push({ role: 'user', content: toInputParts(msg.content) })
    }
  }

  return { instructions: instructions.join('\n\n'), input }
}

/** Map our content blocks to Responses input content parts. */
function toInputParts(blocks: ContentBlockParam[]): unknown[] {
  const parts: unknown[] = []
  for (const b of blocks) {
    if (b.type === 'text') {
      parts.push({ type: 'input_text', text: b.text })
    } else if (b.type === 'image') {
      parts.push({
        type: 'input_image',
        image_url: `data:${b.source.media_type};base64,${b.source.data}`,
      })
    } else if (b.type === 'document') {
      if (b.source.type === 'base64') {
        parts.push({
          type: 'input_file',
          filename: b.title ?? 'document.pdf',
          file_data: `data:application/pdf;base64,${b.source.data}`,
        })
      } else {
        parts.push({ type: 'input_text', text: b.source.data })
      }
    } else if (b.type === 'tool_result') {
      parts.push({
        type: 'input_text',
        text: typeof b.content === 'string' ? b.content : blocksToText(b.content),
      })
    }
  }
  return parts.length ? parts : [{ type: 'input_text', text: '' }]
}

/** Convert an OpenAI-shape ToolDef into a Responses (flat) tool definition. */
function toResponsesTool(tool: ToolDef): Record<string, unknown> {
  return {
    type: 'function',
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
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
