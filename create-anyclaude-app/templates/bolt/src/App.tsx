import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { WebContainer } from '@webcontainer/api'
import { ChatPanel, FileExplorer, useWebContainerPreview, type WebContainerLike } from 'anyclaude-react'
import { Terminal, CodeEditor } from 'anyclaude-react/ide'
import 'anyclaude-react/styles.css'
import { query } from 'anyclaude-sdk/query'
import { createOpenAIClient } from 'anyclaude-sdk/llm'
import { WebContainerWorkspace } from 'anyclaude-sdk/workspace'
import { starterFiles } from './starter'

// WebContainer.boot() may run only once per page — memoize the promise.
let bootPromise: Promise<WebContainer> | null = null
function bootContainer(): Promise<WebContainer> {
  if (!bootPromise) {
    bootPromise = WebContainer.boot().then(async (wc) => {
      await wc.mount(starterFiles)
      return wc
    })
  }
  return bootPromise
}

const CWD = '/'
const langFor = (path: string) =>
  /\.(ts|tsx)$/.test(path) ? 'typescript' : 'javascript'

export function App() {
  const [wc, setWc] = useState<WebContainer | null>(null)
  const [bootErr, setBootErr] = useState<string | null>(null)
  const [install, setInstall] = useState<'idle' | 'installing' | 'done' | 'error'>('idle')
  const [installLog, setInstallLog] = useState('')

  // LLM settings — the agent runs in THIS tab, so the endpoint must allow CORS.
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1')
  const [model, setModel] = useState('gpt-4o')
  const [apiKey, setApiKey] = useState('')

  // Editor state.
  const [openPath, setOpenPath] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [explorerKey, setExplorerKey] = useState(0)

  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  useEffect(() => {
    bootContainer().then(setWc, (e) => setBootErr(e instanceof Error ? e.message : String(e)))
  }, [])

  const { url, status: previewStatus, logs, start, restart } = useWebContainerPreview({
    wc: wc as unknown as WebContainerLike | null,
    autoStart: false,
  })

  // Install deps once, then start the dev server.
  useEffect(() => {
    if (!wc || install !== 'idle') return
    setInstall('installing')
    ;(async () => {
      try {
        const proc = await wc.spawn('npm', ['install'])
        proc.output.pipeTo(new WritableStream({ write: (c) => setInstallLog((p) => (p + c).slice(-8000)) }))
        const code = await proc.exit
        if (code !== 0) throw new Error('npm install exited ' + code)
        setInstall('done')
        void start()
      } catch (e) {
        setInstall('error')
        setInstallLog((p) => p + '\n' + (e instanceof Error ? e.message : String(e)))
      }
    })()
  }, [wc, install, start])

  const llm = useMemo(() => createOpenAIClient({ baseUrl, model, apiKey: apiKey || undefined }), [baseUrl, model, apiKey])
  const workspace = useMemo(() => (wc ? new WebContainerWorkspace(wc, CWD) : null), [wc])

  const run = useCallback(
    (opts: { prompt: string; sessionId: string }) => {
      if (!workspace) throw new Error('WebContainer not ready')
      return query({
        prompt: opts.prompt,
        workspace,
        llm,
        model,
        sessionId: opts.sessionId,
        includePartialMessages: true,
        appendSystemPrompt:
          'You are building a Vite + React app inside a WebContainer at ' +
          CWD +
          '. The entry is src/App.jsx; Vite hot-reloads the preview. Edit files with the file tools; do not run the dev server yourself.',
      })
    },
    [workspace, llm, model]
  )

  const listDir = useCallback(
    async (dir: string) => {
      if (!wc) return []
      const entries = await wc.fs.readdir(dir, { withFileTypes: true })
      return entries
        .filter((e) => e.name !== 'node_modules' && e.name !== '.git')
        .map((e) => ({ name: e.name, isDir: e.isDirectory() }))
    },
    [wc]
  )

  const openFile = useCallback(
    async (path: string) => {
      if (!wc) return
      try {
        const text = await wc.fs.readFile(path, 'utf-8')
        setOpenPath(path)
        setCode(text)
      } catch {
        /* directory or unreadable */
      }
    },
    [wc]
  )

  const saveCode = useCallback(
    (next: string) => {
      setCode(next)
      if (wc && openPath) void wc.fs.writeFile(openPath, next)
    },
    [wc, openPath]
  )

  const refresh = () => {
    if (iframeRef.current && url) iframeRef.current.src = url
    setExplorerKey((k) => k + 1)
  }

  return (
    <div className="app">
      <header className="bar">
        <strong>anyclaude bolt</strong>
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="LLM base URL" style={{ width: 220 }} />
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="model" style={{ width: 120 }} />
        <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="API key (CORS endpoint)" type="password" style={{ width: 170 }} />
        <span className="muted">{wc ? `container ready · install: ${install}` : bootErr ? `boot error` : 'booting…'}</span>
      </header>

      <main className="grid">
        <section className="chat">
          {workspace ? (
            <ChatPanel run={run} title="Builder" placeholder="Ask me to build something…" />
          ) : (
            <div className="placeholder">{bootErr ?? 'Starting the in-browser container…'}</div>
          )}
        </section>

        <section className="workspace">
          <div className="ws-top">
            <div className="explorer">
              <FileExplorer key={explorerKey} list={listDir} root={CWD} onOpen={openFile} openPath={openPath ?? undefined} />
            </div>
            <div className="editor">
              {openPath ? (
                <CodeEditor value={code} onChange={saveCode} language={langFor(openPath)} />
              ) : (
                <div className="placeholder">Select a file to edit. The agent's changes appear here on Refresh.</div>
              )}
            </div>
          </div>
          <div className="terminal">
            {wc ? <Terminal spawn={(size) => wc.spawn('jsh', { terminal: size })} /> : null}
          </div>
        </section>

        <section className="preview">
          <div className="preview-bar">
            <span>Preview · {install === 'done' ? previewStatus : install}</span>
            <button onClick={refresh} disabled={!url}>Refresh</button>
            <button onClick={() => restart()} disabled={install !== 'done'}>Restart</button>
          </div>
          {url ? (
            <iframe ref={iframeRef} src={url} title="preview" />
          ) : (
            <pre className="logs">{install === 'installing' ? installLog || 'Installing dependencies…' : logs || 'Waiting for the dev server…'}</pre>
          )}
        </section>
      </main>
    </div>
  )
}
