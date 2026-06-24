// Stateless Vercel function: it keeps NO server-side state. The browser holds
// the durable transcript (in IndexedDB) and sends it along; we hydrate an
// in-memory store, run the agent loop under a time budget, stream SDKMessages
// as NDJSON, and finally emit a `session_snapshot` so the browser can persist
// the updated transcript. On a `paused` boundary the client re-POSTs to continue.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  query,
  createOpenAIClient,
  MemoryFileSystem,
  NoopCommandExecutor,
  composeWorkspace,
  MemorySessionStore,
  type ChatMsg,
  type SDKMessage,
  type SDKUserMessage,
} from 'anyclaude-sdk'

export const config = { maxDuration: 60 }

async function* empty(): AsyncIterable<SDKUserMessage> {
  /* no new user turn — continueRun resumes the stored loop */
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' })
    return
  }
  const body = (req.body ?? {}) as {
    prompt?: string
    transcript?: ChatMsg[]
    sessionId?: string
    continueRun?: boolean
  }
  const sessionId = body.sessionId || 'default'
  const hasPrior = Array.isArray(body.transcript) && body.transcript.length > 0

  const mem = new MemorySessionStore()
  if (hasPrior) await mem.save(sessionId, body.transcript as ChatMsg[])

  const model = process.env.LLM_MODEL ?? 'claude-sonnet-4-6'
  const llm = createOpenAIClient({
    baseUrl: process.env.LLM_BASE ?? 'https://the3rdacademy.com/api/v1',
    model,
    apiKey: process.env.LLM_KEY,
  })
  const workspace = composeWorkspace(new MemoryFileSystem(), new NoopCommandExecutor(), '/work')

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')

  const write = (m: unknown) => res.write(JSON.stringify(m) + '\n')

  try {
    for await (const m of query({
      prompt: body.continueRun ? empty() : String(body.prompt ?? ''),
      workspace,
      llm,
      model,
      sessionId,
      resume: hasPrior,
      continueRun: !!body.continueRun,
      sessionStore: mem,
      includePartialMessages: true,
      // Low budget so the survivor visibly triggers in the demo (raise for prod).
      maxDurationMs: Number(process.env.MAX_DURATION_MS ?? 20000),
    }) as AsyncIterable<SDKMessage>) {
      write(m)
    }
    const snap = await mem.get?.(sessionId)
    write({ type: 'system', subtype: 'session_snapshot', transcript: snap?.transcript ?? [] })
  } catch (e) {
    write({ type: 'system', subtype: 'error', error: e instanceof Error ? e.message : String(e) })
  }
  res.end()
}
