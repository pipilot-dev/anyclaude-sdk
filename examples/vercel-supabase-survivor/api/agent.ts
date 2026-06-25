// Vercel serverless function: runs the anyclaude-sdk agent loop and streams the
// SDKMessages back as newline-delimited JSON. The "survivor" pauses at a turn
// boundary past MAX_DURATION_MS, persisting the transcript to Supabase; the
// browser client (anyclaude-react) then re-requests with continueRun:true and
// the same sessionId, so the run spans the function's time cap invisibly.
import {
  query,
  createOpenAIClient,
  composeWorkspace,
  MemoryFileSystem,
  NoopCommandExecutor,
  SupabaseSessionStore,
  type SupabaseClientLike,
  type SDKMessage,
} from 'anyclaude-sdk'
import { createClient } from '@supabase/supabase-js'

export const config = { maxDuration: 60 }

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })

  const { prompt, sessionId, continueRun } = (await req.json()) as {
    prompt: string
    sessionId: string
    continueRun?: boolean
  }

  const model = process.env.LLM_MODEL ?? 'kilo-auto/free'
  const llm = createOpenAIClient({
    baseUrl: process.env.LLM_BASE ?? 'https://api.kilo.ai/api/gateway',
    model,
    apiKey: process.env.LLM_KEY,
  })
  const workspace = composeWorkspace(new MemoryFileSystem(), new NoopCommandExecutor(), '/work')

  const supabase = createClient(
    process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  )
  const sessionStore = new SupabaseSessionStore(supabase as unknown as SupabaseClientLike)

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const iter = query({
          prompt: continueRun ? '' : prompt,
          workspace,
          llm,
          model,
          sessionId,
          sessionStore,
          resume: !!continueRun,
          continueRun: !!continueRun,
          includePartialMessages: true,
          maxDurationMs: Number(process.env.MAX_DURATION_MS ?? 20000),
        }) as AsyncIterable<SDKMessage>
        for await (const msg of iter) {
          controller.enqueue(encoder.encode(JSON.stringify(msg) + '\n'))
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'system', subtype: 'error', message }) + '\n'))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
  })
}
