// Browser-only agent chat: the anyclaude-sdk agent loop runs entirely in this
// tab against a keyless LLM endpoint — no server, no API key required.
//
// We import from the SDK's browser-clean subpaths (/query, /llm, /fs) and build
// the workspace inline so nothing pulls Node built-ins into the bundle.
import { query } from 'anyclaude-sdk/query'
import { createOpenAIClient } from 'anyclaude-sdk/llm'
import { MemoryFileSystem } from 'anyclaude-sdk/fs'
import type { SDKMessage, ChatMsg, Workspace } from 'anyclaude-sdk' // type-only → erased at build
import { AgentChat, type RunFn } from 'anyclaude-react'

const env = import.meta.env
const BASE = env.VITE_LLM_BASE ?? 'https://api.kilo.ai/api/gateway' // keyless default
const MODEL = env.VITE_LLM_MODEL ?? 'kilo-auto/free'

// Workspace = an in-memory filesystem + a no-op shell (file tools work; bash is
// unavailable in the browser). Equivalent to composeWorkspace(fs, noopExec).
const fs = new MemoryFileSystem()
const workspace = Object.assign(fs, {
  exec: async () => ({ output: 'bash is not available in the browser workspace', exitCode: 127 }),
}) as unknown as Workspace

const llm = createOpenAIClient({ baseUrl: BASE, model: MODEL, apiKey: env.VITE_LLM_KEY })

// In-tab session memory (multi-turn) — a minimal SessionStoreLike. Each turn
// resumes the prior transcript so the agent remembers the conversation.
const mem = new Map<string, ChatMsg[]>()
const store = {
  async load(id: string) {
    return mem.get(id)?.slice() ?? null
  },
  async save(id: string, transcript: ChatMsg[]) {
    mem.set(id, transcript.slice())
  },
}

const run: RunFn = ({ prompt, sessionId, continueRun }) =>
  query({
    prompt,
    workspace,
    llm,
    model: MODEL,
    sessionId,
    sessionStore: store,
    resume: true,
    continueRun,
    includePartialMessages: true,
  }) as AsyncIterable<SDKMessage>

export function App() {
  return (
    <div className="app">
      <header className="app-head">
        <h1>anyclaude · browser chat</h1>
        <p>
          The agent loop runs <strong>entirely in this tab</strong> — no backend, no API key
          (keyless endpoint). Streaming + tool calls included.
        </p>
      </header>
      <AgentChat className="ac-chat" run={run} placeholder="Ask the agent to write a file, explain code, anything…" />
    </div>
  )
}
