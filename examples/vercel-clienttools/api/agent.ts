// Vercel serverless function — the agent "brain". It runs the anyclaude-sdk
// agent loop but declares bash + the file tools as CLIENT TOOLS: it never
// executes them. When the model calls one, the loop pauses at the turn boundary
// and emits a `{type:'system',subtype:'client_tool_request'}` (plus the survivor
// `paused` boundary), persisting the transcript to Vercel KV. The browser
// executes the tool on a real WebContainer and re-POSTs with `clientToolResults`
// + `continueRun:true`; the loop resumes from KV, injects the results, and
// continues. Server = brain, browser = hands.
import {
  query,
  createOpenAIClient,
  MemoryFileSystem,
  NoopCommandExecutor,
  composeWorkspace,
  KVSessionStore,
} from 'anyclaude-sdk'
import { kv } from '@vercel/kv'

export const config = { maxDuration: 60 } // Hobby allows up to 300s

// Tools the server declares but does NOT run — the browser's WebContainer does.
const CLIENT_TOOLS = ['bash', 'write_file', 'read_file', 'edit_file', 'list_files']

interface ClientToolResult {
  tool_use_id: string
  content: string
  is_error?: boolean
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  const { prompt, sessionId, continueRun, clientToolResults } = (await req.json()) as {
    prompt?: string
    sessionId: string
    continueRun?: boolean
    clientToolResults?: ClientToolResult[]
  }

  const model = process.env.LLM_MODEL ?? 'claude-sonnet-4-6'
  const llm = createOpenAIClient({
    baseUrl: process.env.LLM_BASE ?? 'https://the3rdacademy.com/api/v1',
    model,
    apiKey: process.env.LLM_KEY,
  })
  // The server workspace is never used for the client tools (they're skipped on
  // the server); it only backs any non-client tools the agent might call.
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
          resume: !!continueRun,
          continueRun: !!continueRun,
          sessionStore,
          // bash + file tools run on the browser's WebContainer, not here:
          clientTools: CLIENT_TOOLS,
          clientToolResults,
          maxDurationMs: Number(process.env.MAX_DURATION_MS ?? 20000),
          includePartialMessages: true,
          appendSystemPrompt:
            'You run commands and edit files on a real Linux WebContainer in the user\'s browser via bash, write_file, read_file, edit_file and list_files. The working directory is /home/work. Prefer running real commands over guessing.',
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
