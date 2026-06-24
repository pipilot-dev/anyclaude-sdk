// Vercel serverless function: runs the anyclaude-sdk agent loop and streams the
// SDKMessages back as NDJSON. The "survivor" pauses the loop at a turn boundary
// past `maxDurationMs`, persists the transcript to Vercel KV, and emits a
// `{type:'system',subtype:'paused'}` message. The browser's anyclaude-react
// endpoint client then re-requests with `continueRun:true` (same sessionId), so
// the agent resumes from KV and the run spans the function time cap seamlessly.
import {
  query,
  createOpenAIClient,
  MemoryFileSystem,
  NoopCommandExecutor,
  composeWorkspace,
  KVSessionStore,
} from 'anyclaude-sdk'
import { kv } from '@vercel/kv'

export const config = { maxDuration: 60 } // Hobby allows up to 300s; 60 is plenty here

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  const { prompt, sessionId, continueRun } = (await req.json()) as {
    prompt?: string
    sessionId: string
    continueRun?: boolean
  }

  const model = process.env.LLM_MODEL ?? 'claude-sonnet-4-6'
  const llm = createOpenAIClient({
    baseUrl: process.env.LLM_BASE ?? 'https://the3rdacademy.com/api/v1',
    model,
    apiKey: process.env.LLM_KEY,
  })
  const workspace = composeWorkspace(new MemoryFileSystem(), new NoopCommandExecutor(), '/work')
  const sessionStore = new KVSessionStore(kv)

  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const msg of query({
          prompt: prompt ?? '',
          workspace,
          llm,
          model,
          sessionId,
          resume: !!continueRun, // continuation resumes the stored transcript
          continueRun: !!continueRun,
          sessionStore,
          // LOW budget so the survivor visibly triggers in a demo. Set
          // MAX_DURATION_MS=3000 to force pause→continue even on short tasks.
          maxDurationMs: Number(process.env.MAX_DURATION_MS ?? 20000),
          includePartialMessages: true,
        })) {
          controller.enqueue(enc.encode(JSON.stringify(msg) + '\n'))
        }
      } catch (err) {
        controller.enqueue(
          enc.encode(JSON.stringify({ type: 'system', subtype: 'error', error: String(err) }) + '\n')
        )
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' },
  })
}
