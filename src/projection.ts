// Server-side stream projection — redact what the browser receives.
//
// `query()` runs the full agent loop server-side (system prompt, tool
// instructions, retrieved context all stay on the server, in the request to the
// LLM — never in an SDKMessage). What *does* reach a browser client over an
// endpoint are the streamed SDKMessages: assistant content, synthetic
// tool_result messages (raw tool output + RAG chunks), reasoning blocks, and the
// init/result envelopes (model/provider, tool names). This transform projects
// that stream down to only what a UI needs, so the Network tab is harmless.
//
// It is a PURE OUTPUT TRANSFORM applied AFTER query() yields — it never touches
// the agent loop or its internal history, so it cannot change agent behavior.
// Wrap it around query() in your endpoint handler:
//
//   for await (const m of projectMessages(query({ ... }), { preset: 'public' }))
//     res.write(JSON.stringify(m) + '\n')
//
// Control messages the client must act on (`paused` for the survivor,
// `client_tool_request` for client-side tools) are always preserved intact.
import type { SDKMessage, ContentBlockParam } from './types/index.js'

export type ProjectionPreset = 'public' | 'raw'

export interface ProjectionOptions {
  /** 'public' (browser-safe defaults) or 'raw' (passthrough; only explicit opts apply). Default 'public'. */
  preset?: ProjectionPreset
  /** Replace tool_result block content with a placeholder — hides raw tool output + RAG context. */
  redactToolResults?: boolean
  /** Drop synthetic tool_result messages entirely instead of redacting their content. */
  dropToolResults?: boolean
  /** Remove thinking/reasoning blocks and deltas. */
  stripReasoning?: boolean
  /** Remove tool_use input args (tool NAMES still appear via usage). */
  stripToolInput?: boolean
  /** Remove model/provider-identifying fields (model name, tool list, mcp servers, modelUsage). */
  stripModelInfo?: boolean
  /** Placeholder substituted for redacted content. Default '[redacted]'. */
  placeholder?: string
  /** Drop any message whose `type` or `subtype` is in this list. */
  drop?: string[]
  /** Custom transform applied last; return null to drop the message. */
  redact?: (m: SDKMessage) => SDKMessage | null
}

type Resolved = Required<Omit<ProjectionOptions, 'preset' | 'redact'>> & Pick<ProjectionOptions, 'redact'>

function resolve(o: ProjectionOptions): Resolved {
  const pub = (o.preset ?? 'public') === 'public'
  return {
    redactToolResults: o.redactToolResults ?? pub,
    dropToolResults: o.dropToolResults ?? false,
    stripReasoning: o.stripReasoning ?? pub,
    stripToolInput: o.stripToolInput ?? false,
    stripModelInfo: o.stripModelInfo ?? pub,
    placeholder: o.placeholder ?? '[redacted]',
    drop: o.drop ?? [],
    redact: o.redact,
  }
}

type Any = Record<string, unknown>

/** Project one message. Returns null to drop it. */
export function projectMessage(msg: SDKMessage, options: ProjectionOptions = {}): SDKMessage | null {
  const o = resolve(options)
  const m = msg as Any
  const type = m.type as string
  const subtype = m.subtype as string | undefined

  if (o.drop.includes(type) || (subtype && o.drop.includes(subtype))) return null

  // Control messages the client must act on — never alter (survivor + client tools).
  if (type === 'system' && (subtype === 'paused' || subtype === 'client_tool_request')) {
    return o.redact ? o.redact(msg) : msg
  }

  let out: SDKMessage = msg

  if (type === 'user') {
    // Synthetic tool_result messages carry raw tool output + retrieved context.
    const message = m.message as Any | undefined
    const content = message?.content
    if (Array.isArray(content) && content.some((b) => (b as Any).type === 'tool_result')) {
      if (o.dropToolResults) return o.redact ? o.redact(msg) ?? null : null
      if (o.redactToolResults) {
        const newContent = (content as ContentBlockParam[]).map((b) =>
          b.type === 'tool_result' ? { ...b, content: o.placeholder } : b
        )
        out = { ...m, message: { ...message, content: newContent } } as unknown as SDKMessage
      }
    }
  } else if (type === 'assistant') {
    const message = m.message as Any
    let content = message.content as ContentBlockParam[]
    if (o.stripReasoning) content = content.filter((b) => b.type !== 'thinking')
    if (o.stripToolInput) content = content.map((b) => (b.type === 'tool_use' ? { ...b, input: {} } : b))
    const newMessage: Any = { ...message, content }
    if (o.stripModelInfo) newMessage.model = ''
    out = { ...m, message: newMessage } as unknown as SDKMessage
  } else if (type === 'stream_event') {
    const event = m.event as Any
    const et = event?.type as string | undefined
    if (o.stripReasoning) {
      if (et === 'content_block_delta' && (event.delta as Any)?.type === 'thinking_delta') return null
      if (et === 'content_block_start' && (event.content_block as Any)?.type === 'thinking') return null
    }
    if (o.stripModelInfo && et === 'message_start') {
      const sm = { ...(event.message as Any) }
      delete sm.model
      out = { ...m, event: { ...event, message: sm } } as unknown as SDKMessage
    }
  } else if (type === 'system' && subtype === 'init') {
    if (o.stripModelInfo) {
      out = {
        ...m,
        model: '',
        tools: [],
        mcp_servers: [],
        slash_commands: [],
        skills: [],
        agents: [],
        apiKeySource: 'none',
        cwd: '',
      } as unknown as SDKMessage
    }
  } else if (type === 'result') {
    if (o.stripModelInfo) {
      out = { ...m, modelUsage: {} } as unknown as SDKMessage
    }
  }

  return o.redact ? o.redact(out) : out
}

/**
 * Wrap an SDKMessage stream, projecting each message for browser delivery.
 * Pure output transform — does NOT affect the agent loop. Opt-in.
 */
export async function* projectMessages(
  source: AsyncIterable<SDKMessage>,
  options: ProjectionOptions = {}
): AsyncGenerator<SDKMessage> {
  for await (const m of source) {
    const out = projectMessage(m, options)
    if (out) yield out
  }
}
