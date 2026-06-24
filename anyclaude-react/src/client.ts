// Framework-agnostic agent client with serverless "survivor" stream-stitching.
//
// A logical run may span multiple underlying runs: when the agent hits a
// function time-limit it emits a `{ type:'system', subtype:'paused' }` boundary
// and persists its transcript. This client detects that, transparently fires a
// CONTINUATION run (same sessionId, continueRun:true), and keeps yielding — so a
// function-cap pause is invisible to the consumer. One sessionId per conversation.
import type { SDKMessage } from 'anyclaude-sdk'

export interface RunOptions {
  prompt: string
  sessionId: string
  continueRun?: boolean
}

/** Produces the raw SDKMessage stream for one underlying run (in-process or remote). */
export type RunFn = (opts: RunOptions) => AsyncIterable<SDKMessage>

export interface AgentClient {
  /** Stream one logical run for `prompt` under `sessionId`, survivor-stitched. */
  send(prompt: string, sessionId: string): AsyncIterable<SDKMessage>
}

function isPaused(m: SDKMessage): boolean {
  return m.type === 'system' && (m as { subtype?: string }).subtype === 'paused'
}

/**
 * Build an AgentClient from a `run` function. `run` does ONE underlying run —
 * e.g. wrapping the SDK's `query()` in-process, or a fetch to a serverless
 * endpoint. The stitching across `paused` boundaries is handled here.
 */
export function createAgentClient({ run }: { run: RunFn }): AgentClient {
  return {
    async *send(prompt: string, sessionId: string): AsyncIterable<SDKMessage> {
      let continueRun = false
      for (;;) {
        let paused = false
        for await (const m of run({ prompt: continueRun ? '' : prompt, sessionId, continueRun })) {
          if (isPaused(m)) paused = true
          yield m // forward everything (incl. the paused boundary) — consumers may show "paused"
        }
        if (!paused) break
        continueRun = true // next iteration resumes + continues the same session
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
}

/**
 * AgentClient backed by a serverless function. POSTs `{ prompt, sessionId,
 * continueRun, ...body }` and reads a newline-delimited JSON stream of
 * SDKMessages. Survivor-stitched automatically.
 */
export function createEndpointClient(opts: EndpointClientOptions): AgentClient {
  const run: RunFn = async function* ({ prompt, sessionId, continueRun }) {
    const res = await fetch(opts.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...opts.headers },
      body: JSON.stringify({ prompt, sessionId, continueRun, ...opts.body }),
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
  return createAgentClient({ run })
}
