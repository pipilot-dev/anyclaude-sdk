import { useCallback, useEffect, useMemo, useState } from 'react'
import { WebContainer } from '@webcontainer/api'
import { ChatPanel, FileExplorer, createWebContainerClientTools } from 'anyclaude-react'
import { Terminal, CodeEditor, type ShellProcess } from 'anyclaude-react/ide'

const CWD = '/home/work'

// Boot exactly one WebContainer per tab.
let bootPromise: Promise<WebContainer> | null = null
const bootWC = () => (bootPromise ??= WebContainer.boot())

export function App() {
  const [wc, setWc] = useState<WebContainer | null>(null)
  const [openPath, setOpenPath] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let alive = true
    bootWC().then(async (c) => {
      if (!alive) return
      try {
        await c.fs.mkdir(CWD, { recursive: true })
      } catch {
        /* exists */
      }
      setWc(c)
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

  // The same WebContainer backs both the visible terminal AND the agent's
  // client-side tools — so you watch the server's agent operate your browser.
  const clientTools = useMemo(() => (wc ? createWebContainerClientTools(wc, { cwd: CWD }) : undefined), [wc])

  const listDir = useCallback(
    async (dir: string) => {
      if (!wc) return []
      const entries = (await wc.fs.readdir(dir, { withFileTypes: true })) as Array<{
        name: string
        isDirectory(): boolean
      }>
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
    (size: { cols: number; rows: number }) =>
      wc!.spawn('jsh', { terminal: size }) as unknown as Promise<ShellProcess>,
    [wc]
  )

  if (!wc || !clientTools) {
    return <div className="boot">Booting WebContainer…</div>
  }

  return (
    <div className="ide">
      <header className="ide-head">
        <span className="ide-brand">◆ anyclaude · client-tools</span>
        <span className="ide-sub">
          agent runs on a Vercel function — its bash &amp; file tools execute on this tab&apos;s WebContainer
        </span>
      </header>
      <div className="ide-body">
        <FileExplorer
          list={listDir}
          root={CWD}
          openPath={openPath}
          onOpen={openFile}
          refreshKey={refreshKey}
          className="ide-files"
        />
        <div className="ide-center">
          <div className="ide-editor-bar">
            <span>{openPath ?? 'Select a file'}</span>
            <button onClick={save} disabled={!openPath}>
              Save
            </button>
          </div>
          <CodeEditor value={content} onChange={setContent} className="ide-editor" />
          <Terminal spawn={spawn} className="ide-term" />
        </div>
        <ChatPanel
          endpoint="/api/agent"
          clientTools={clientTools}
          title="Agent (server brain)"
          className="ide-chat"
          placeholder="Ask the agent to run commands or build files…"
        />
      </div>
    </div>
  )
}
