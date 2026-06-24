// Browser-side agent client for the "IndexedDB + stateless function" survivor
// pattern. The transcript lives in IndexedDB (the SDK's Dexie SessionStore);
// each turn we load it, POST it to the stateless /api/agent, stream the reply,
// persist the returned `session_snapshot`, and — if the server paused at its
// time budget — re-POST to continue until the run finishes. The function-cap
// pause is invisible; the server keeps no state.
import { SessionStore } from 'anyclaude-sdk'

export type AnyMessage = Record<string, unknown> & { type?: string; subtype?: string }
export type Status = 'idle' | 'running' | 'paused'

export interface IdbAgentClient {
  readonly sessionId: string
  send(prompt: string, onMessage: (m: AnyMessage) => void, onStatus: (s: Status) => void): Promise<void>
}

export function createIdbAgentClient(opts: { endpoint?: string; sessionId?: string } = {}): IdbAgentClient {
  const endpoint = opts.endpoint ?? '/api/agent'
  const sessionId = opts.sessionId ?? 'idb-' + (globalThis.crypto?.randomUUID?.() ?? String(Date.now()))
  const store = new SessionStore({ dbName: 'anyclaude-idb-example' })

  async function postAndStream(
    body: Record<string, unknown>,
    onMessage: (m: AnyMessage) => void
  ): Promise<{ paused: boolean }> {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok || !res.body) throw new Error(`agent request failed: ${res.status}`)
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    let paused = false
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        let m: AnyMessage
        try {
          m = JSON.parse(line) as AnyMessage
        } catch {
          continue
        }
        if (m.type === 'system' && m.subtype === 'session_snapshot') {
          // Persist the updated transcript to IndexedDB (the durable store).
          await store.save(sessionId, (m.transcript as never) ?? [])
          continue
        }
        if (m.type === 'system' && m.subtype === 'paused') paused = true
        onMessage(m)
      }
    }
    return { paused }
  }

  async function send(
    prompt: string,
    onMessage: (m: AnyMessage) => void,
    onStatus: (s: Status) => void
  ): Promise<void> {
    onStatus('running')
    try {
      const prior = await store.load(sessionId)
      let { paused } = await postAndStream(
        { prompt, sessionId, transcript: prior ?? undefined, continueRun: false },
        onMessage
      )
      // Survivor: keep continuing across function-cap pauses until done.
      while (paused) {
        onStatus('paused')
        const t = await store.load(sessionId)
        const r = await postAndStream({ sessionId, transcript: t ?? [], continueRun: true }, onMessage)
        paused = r.paused
        onStatus('running')
      }
    } finally {
      onStatus('idle')
    }
  }

  return { sessionId, send }
}
