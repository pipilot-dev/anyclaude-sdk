// Framework-agnostic agent client with serverless "survivor" stream-stitching.
//
// A logical run may span multiple underlying runs: when the agent hits a
// function time-limit it emits a `{ type:'system', subtype:'paused' }` boundary
// and persists its transcript. This client detects that, transparently fires a
// CONTINUATION run (same sessionId, continueRun:true), and keeps yielding — so a
// function-cap pause is invisible to the consumer. One sessionId per conversation.
import type { SDKMessage } from 'anyclaude-sdk'

export interface ClientToolResult {
  tool_use_id: string
  content: string | unknown
  is_error?: boolean
}

export interface RunOptions {
  prompt: string
  sessionId: string
  continueRun?: boolean
  /** Results of host-executed client tools, carried into a continuation run. */
  clientToolResults?: ClientToolResult[]
}

/** Produces the raw SDKMessage stream for one underlying run (in-process or remote). */
export type RunFn = (opts: RunOptions) => AsyncIterable<SDKMessage>

/** Executor for a host/client-side tool (e.g. run `bash` on a WebContainer). */
export type ClientToolExecutor = (
  input: Record<string, unknown>,
  req: { tool_use_id: string; name: string }
) => Promise<{ content: string | unknown; is_error?: boolean }> | { content: string | unknown; is_error?: boolean }

/** Map of tool name → host executor. */
export type ClientToolMap = Record<string, ClientToolExecutor>

export interface AgentClient {
  /** Stream one logical run for `prompt` under `sessionId`, survivor-stitched. */
  send(prompt: string, sessionId: string): AsyncIterable<SDKMessage>
}

function isPaused(m: SDKMessage): boolean {
  return m.type === 'system' && (m as { subtype?: string }).subtype === 'paused'
}
function clientToolReq(m: SDKMessage): { tool_use_id: string; name: string; input: Record<string, unknown> } | null {
  if (m.type === 'system' && (m as { subtype?: string }).subtype === 'client_tool_request') {
    return (m as { request?: { tool_use_id: string; name: string; input: Record<string, unknown> } }).request ?? null
  }
  return null
}

/**
 * Build an AgentClient from a `run` function. `run` does ONE underlying run —
 * e.g. wrapping the SDK's `query()` in-process, or a fetch to a serverless
 * endpoint. This stitches across `paused` boundaries (survivor) AND executes
 * client-side tools: on a `client_tool_request`, it runs the matching
 * `clientTools` executor and feeds the result into the continuation.
 */
export function createAgentClient({ run, clientTools }: { run: RunFn; clientTools?: ClientToolMap }): AgentClient {
  return {
    async *send(prompt: string, sessionId: string): AsyncIterable<SDKMessage> {
      let continueRun = false
      let pending: ClientToolResult[] | undefined
      for (;;) {
        let paused = false
        const requests: Array<{ tool_use_id: string; name: string; input: Record<string, unknown> }> = []
        for await (const m of run({ prompt: continueRun ? '' : prompt, sessionId, continueRun, clientToolResults: pending })) {
          const req = clientToolReq(m)
          if (req) requests.push(req)
          if (isPaused(m)) paused = true
          yield m // forward everything (incl. paused + client_tool_request) so the UI can react
        }
        if (!paused) break
        continueRun = true
        // Execute any client-side tool requests, carry the results into the next run.
        pending = undefined
        if (requests.length && clientTools) {
          pending = []
          for (const req of requests) {
            const exec = clientTools[req.name]
            try {
              if (!exec) {
                pending.push({ tool_use_id: req.tool_use_id, content: `No client executor for tool "${req.name}".`, is_error: true })
              } else {
                const r = await exec(req.input, { tool_use_id: req.tool_use_id, name: req.name })
                pending.push({ tool_use_id: req.tool_use_id, content: r.content, is_error: r.is_error })
              }
            } catch (e) {
              pending.push({ tool_use_id: req.tool_use_id, content: `Error: ${e instanceof Error ? e.message : String(e)}`, is_error: true })
            }
          }
        }
      }
    },
  }
}

export interface EndpointClientOptions {
  /** URL of a serverless function that streams NDJSON SDKMessages. */
  endpoint: string
  headers?: Record<string, string>
  /** Extra fields merged into the POST body (e.g. model, auth context). */
  body?: Record<string, unknown>
  /** Host executors for client-side tools (e.g. run `bash` on a WebContainer). */
  clientTools?: ClientToolMap
}

/**
 * AgentClient backed by a serverless function. POSTs `{ prompt, sessionId,
 * continueRun, ...body }` and reads a newline-delimited JSON stream of
 * SDKMessages. Survivor-stitched automatically.
 */
export function createEndpointClient(opts: EndpointClientOptions): AgentClient {
  const run: RunFn = async function* ({ prompt, sessionId, continueRun, clientToolResults }) {
    const res = await fetch(opts.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...opts.headers },
      body: JSON.stringify({ prompt, sessionId, continueRun, clientToolResults, ...opts.body }),
    })
    if (!res.body) return
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line) {
          try {
            yield JSON.parse(line) as SDKMessage
          } catch {
            /* skip non-JSON keepalive lines */
          }
        }
      }
    }
    const tail = buf.trim()
    if (tail) {
      try {
        yield JSON.parse(tail) as SDKMessage
      } catch {
        /* ignore */
      }
    }
  }
  return createAgentClient({ run, clientTools: opts.clientTools })
}
