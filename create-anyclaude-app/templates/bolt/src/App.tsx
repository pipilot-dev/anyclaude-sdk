import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { WebContainer } from '@webcontainer/api'
import { ChatPanel, useWebContainerPreview, type WebContainerLike } from 'anyclaude-react'
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

export function App() {
  const [wc, setWc] = useState<WebContainer | null>(null)
  const [bootErr, setBootErr] = useState<string | null>(null)

  // LLM settings — the agent runs in THIS tab, so the endpoint must allow CORS.
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1')
  const [model, setModel] = useState('gpt-4o')
  const [apiKey, setApiKey] = useState('')

  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  useEffect(() => {
    bootContainer().then(setWc, (e) => setBootErr(e instanceof Error ? e.message : String(e)))
  }, [])

  const { url, status: previewStatus, logs, restart } = useWebContainerPreview({
    wc: wc as unknown as WebContainerLike | null,
    autoStart: true,
  })

  const llm = useMemo(
    () => createOpenAIClient({ baseUrl, model, apiKey: apiKey || undefined }),
    [baseUrl, model, apiKey]
  )
  const workspace = useMemo(() => (wc ? new WebContainerWorkspace(wc, '/') : null), [wc])

  // Drive the agent in-browser: one underlying run = one query() over the container.
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
          'You are building a web app inside a WebContainer. Edit files under the cwd (index.html is the entry, served at :3000). Keep it dependency-free unless asked.',
      })
    },
    [workspace, llm, model]
  )

  const refresh = () => {
    if (iframeRef.current && url) iframeRef.current.src = url
  }

  return (
    <div className="app">
      <header className="bar">
        <strong>anyclaude bolt</strong>
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="LLM base URL" style={{ width: 230 }} />
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="model" style={{ width: 130 }} />
        <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="API key (CORS endpoint)" type="password" style={{ width: 180 }} />
        <span className="muted">{wc ? 'container ready' : bootErr ? `boot error: ${bootErr}` : 'booting…'}</span>
      </header>

      <main className="grid">
        <section className="chat">
          {workspace ? (
            <ChatPanel run={run} title="Builder" placeholder="Ask me to build something…" />
          ) : (
            <div className="placeholder">{bootErr ?? 'Starting the in-browser container…'}</div>
          )}
        </section>

        <section className="preview">
          <div className="preview-bar">
            <span>Preview · {previewStatus}</span>
            <button onClick={refresh} disabled={!url}>Refresh preview</button>
            <button onClick={() => restart()}>Restart server</button>
          </div>
          {url ? (
            <iframe ref={iframeRef} src={url} title="preview" />
          ) : (
            <pre className="logs">{logs || 'Waiting for the dev server…'}</pre>
          )}
        </section>
      </main>
    </div>
  )
}
