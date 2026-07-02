import { useEffect, useMemo, useState, useCallback } from 'react'
import { WebContainer } from '@webcontainer/api'
import { WebContainerWorkspace } from 'anyclaude-sdk/workspace'
import { query } from 'anyclaude-sdk/query'
import { createOpenAIClient } from 'anyclaude-sdk/llm'
import type { SDKMessage } from 'anyclaude-sdk'
import { ChatPanel, FileExplorer, AskUser, type AskUserQuestion } from 'anyclaude-react'
import { Terminal, CodeEditor, type ShellProcess } from 'anyclaude-react/ide'

const CWD = '/home/projects'
const WC_PROMPT = `Environment: a browser WebContainer. The bash tool runs a real \`jsh\` POSIX-ish shell with Node.js + npm available, but NO Python. Build and run things with node/npm (e.g. \`node app.js\`), never python. The working directory is ${CWD}.`

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}
const llm = createOpenAIClient({
  baseUrl: env.VITE_LLM_BASE ?? 'https://the3rdacademy.com/api/v1',
  model: env.VITE_LLM_MODEL ?? 'claude-sonnet-4-6',
  apiKey: env.VITE_LLM_KEY,
})
const MODEL = env.VITE_LLM_MODEL ?? 'claude-sonnet-4-6'

let bootPromise: Promise<WebContainer> | null = null
const bootWC = () => (bootPromise ??= WebContainer.boot())

export function App() {
  const [wc, setWc] = useState<WebContainer | null>(null)
  const [workspace, setWorkspace] = useState<WebContainerWorkspace | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)
  const [openPath, setOpenPath] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [pendingQ, setPendingQ] = useState<{ q: AskUserQuestion; resolve: (a: string | string[]) => void } | null>(null)

  // Boot WebContainer once.
  useEffect(() => {
    let alive = true
    bootWC()
      .then((c) => {
        if (!alive) return
        setWc(c)
        setWorkspace(new WebContainerWorkspace(c, CWD))
      })
      .catch((e) => {
        if (!alive) return
        setBootError(
          (e instanceof Error ? e.message : String(e)) +
            (self.crossOriginIsolated ? '' : ' — page is not cross-origin isolated; try a hard refresh.')
        )
      })
    return () => {
      alive = false
    }
  }, [])

  // Reflect agent-written files in the explorer.
  useEffect(() => {
    const t = setInterval(() => setRefreshKey((k) => k + 1), 3000)
    return () => clearInterval(t)
  }, [])

  const onAskUser = useCallback(
    (q: AskUserQuestion) => new Promise<string | string[]>((resolve) => setPendingQ({ q, resolve })),
    []
  )

  const run = useMemo(() => {
    if (!workspace) return undefined
    return (opts: { prompt: string | AsyncIterable<unknown>; sessionId: string; continueRun?: boolean }) =>
      query({
        prompt: opts.prompt as never,
        workspace,
        llm,
        model: MODEL,
        sessionId: opts.sessionId,
        resume: !!opts.continueRun,
        continueRun: opts.continueRun,
        includePartialMessages: true,
        appendSystemPrompt: WC_PROMPT,
        onAskUser,
      }) as AsyncIterable<SDKMessage>
  }, [workspace, onAskUser])

  const listDir = useCallback(
    async (dir: string) => {
      if (!wc) return []
      const entries = (await wc.fs.readdir(dir, { withFileTypes: true })) as Array<{ name: string; isDirectory(): boolean }>
      return entries.map((e) => ({ name: e.name, isDir: e.isDirectory() }))
    },
    [wc]
  )

  const openFile = useCallback(
    async (path: string) => {
      if (!wc) return
      setOpenPath(path)
      try {
        setContent(await wc.fs.readFile(path, 'utf-8'))
      } catch {
        setContent('(binary or unreadable file)')
      }
    },
    [wc]
  )

  const save = useCallback(async () => {
    if (!wc || !openPath) return
    await wc.fs.writeFile(openPath, content)
    setRefreshKey((k) => k + 1)
  }, [wc, openPath, content])

  const spawn = useCallback(
    (size: { cols: number; rows: number }) => wc!.spawn('jsh', { terminal: size }) as unknown as Promise<ShellProcess>,
    [wc]
  )

  if (bootError) {
    return <div className="boot">WebContainer failed to start: {bootError}</div>
  }
  if (!wc || !workspace || !run) {
    return <div className="boot">Booting WebContainer…</div>
  }

  return (
    <div className="ide">
      <header className="ide-head">
        <span className="ide-brand">◆ anyclaude · browser IDE</span>
        <span className="ide-sub">runs the agent + a real Node shell entirely in your tab</span>
      </header>
      <div className="ide-body">
        <FileExplorer list={listDir} root={CWD} openPath={openPath} onOpen={openFile} refreshKey={refreshKey} className="ide-files" />
        <div className="ide-center">
          <div className="ide-editor-bar">
            <span>{openPath ?? 'Select a file'}</span>
            <button onClick={save} disabled={!openPath}>Save</button>
          </div>
          <CodeEditor value={content} onChange={setContent} className="ide-editor" />
          <Terminal spawn={spawn} className="ide-term" />
        </div>
        <ChatPanel run={run} title="Agent" className="ide-chat" placeholder="Ask the agent to build something…" />
      </div>
      {pendingQ && (
        <div className="ide-overlay" onClick={() => {}}>
          <AskUser
            question={pendingQ.q}
            onAnswer={(a) => {
              pendingQ.resolve(a)
              setPendingQ(null)
            }}
          />
        </div>
      )}
    </div>
  )
}
