import { useEffect, useRef, useState } from 'react'
import type { WebContainer } from '@webcontainer/api'
import { WebContainerWorkspace } from '@browser-claude-sdk/core'
import { bootWebContainer } from './webcontainer'
import { ChatPanel } from './components/ChatPanel'
import { FileExplorer } from './components/FileExplorer'
import { EditorPane } from './components/EditorPane'
import { TerminalView } from './components/Terminal'

const DEFAULT_BASE_URL = 'https://the3rdacademy.com/api/v1'
const DEFAULT_MODEL = 'claude-sonnet-4-6'

export function App() {
  const [wc, setWc] = useState<WebContainer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const workspaceRef = useRef<WebContainerWorkspace | null>(null)

  // Shared UI state.
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL)
  const [model, setModel] = useState(DEFAULT_MODEL)
  const [openPath, setOpenPath] = useState<string | null>(null)
  const [fsVersion, setFsVersion] = useState(0) // bump to refresh the explorer

  useEffect(() => {
    let cancelled = false
    bootWebContainer()
      .then((instance) => {
        if (cancelled) return
        workspaceRef.current = new WebContainerWorkspace(instance)
        setWc(instance)
      })
      .catch((e) => setError(e?.message ?? String(e)))
    return () => {
      cancelled = true
    }
  }, [])

  const refreshFs = () => setFsVersion((v) => v + 1)

  if (error) {
    return (
      <div className="boot-error">
        <h2>WebContainer failed to boot</h2>
        <pre>{error}</pre>
        <p>
          WebContainer needs cross-origin isolation. Make sure the dev server sends
          <code> Cross-Origin-Opener-Policy: same-origin</code> and
          <code> Cross-Origin-Embedder-Policy: require-corp</code> (configured in
          vite.config.ts).
        </p>
      </div>
    )
  }

  if (!wc) {
    return <div className="booting">Booting WebContainer…</div>
  }

  const workspace = workspaceRef.current!

  return (
    <div className="layout">
      <div className="chat-col">
        <ChatPanel
          workspace={workspace}
          baseUrl={baseUrl}
          model={model}
          onBaseUrl={setBaseUrl}
          onModel={setModel}
          onActivity={refreshFs}
        />
      </div>
      <div className="work-col">
        <div className="work-top">
          <FileExplorer
            wc={wc}
            version={fsVersion}
            openPath={openPath}
            onOpen={setOpenPath}
            onRefresh={refreshFs}
          />
          <EditorPane wc={wc} path={openPath} onSaved={refreshFs} />
        </div>
        <div className="work-bottom">
          <TerminalView wc={wc} />
        </div>
      </div>
    </div>
  )
}
