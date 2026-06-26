import { useCallback, useEffect, useMemo, useState } from 'react'
// Browser-clean SDK subpaths only (the root barrel pulls Node builtins + comlink).
import { query } from 'anyclaude-sdk/query'
import { createOpenAIClient } from 'anyclaude-sdk/llm'
import { DexieFileSystem } from 'anyclaude-sdk/fs'
import type { SDKMessage } from 'anyclaude-sdk'
import { ChatPanel, FileExplorer } from 'anyclaude-react'
import { CodeEditor } from 'anyclaude-react/ide'

// The agent's built-in file tools execute against THIS IndexedDB database.
// Change the name to switch "location"; `new DexieFileSystem(name, { db })` can
// share a Dexie instance your app already owns.
const DB_NAME = 'anyclaude-demo-fs'
const fs = new DexieFileSystem(DB_NAME)
// No shell in a pure IndexedDB workspace — give the tool loop a CommandExecutor
// that politely refuses, and tell the model to use file tools only.
const workspace = Object.assign(fs, {
  exec: async () => ({ output: 'No shell in this workspace (IndexedDB filesystem only).', exitCode: 127 }),
})
const NO_SHELL = `This is a browser IndexedDB workspace — there is NO shell and no runtimes. Use ONLY the file tools (write_file / read_file / edit_file / list_files / glob / grep) to build and edit files; never call bash. Files persist in the browser IndexedDB database "${DB_NAME}" and survive reloads.`

interface Settings { endpoint: string; model: string; apiKey: string }
const SETTINGS_KEY = 'anyclaude-idb-llm'
function loadSettings(): Settings {
  try {
    return { endpoint: '', model: '', apiKey: '', ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }
  } catch {
    return { endpoint: '', model: '', apiKey: '' }
  }
}

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [showSettings, setShowSettings] = useState(!loadSettings().endpoint)
  const [openPath, setOpenPath] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  // Persist settings.
  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }, [settings])

  // Reflect agent-written files in the explorer.
  useEffect(() => {
    const t = setInterval(() => setRefreshKey((k) => k + 1), 2500)
    return () => clearInterval(t)
  }, [])

  const configured = !!settings.endpoint && !!settings.model

  const llm = useMemo(() => {
    if (!configured) return undefined
    return createOpenAIClient({
      baseUrl: settings.endpoint,
      model: settings.model,
      apiKey: settings.apiKey || undefined,
    })
  }, [configured, settings.endpoint, settings.model, settings.apiKey])

  const run = useMemo(() => {
    if (!llm) return undefined
    return (opts: { prompt: string | AsyncIterable<unknown>; sessionId: string; continueRun?: boolean }) =>
      query({
        prompt: opts.prompt as never,
        workspace: workspace as never,
        llm,
        model: settings.model,
        sessionId: opts.sessionId,
        resume: !!opts.continueRun,
        continueRun: opts.continueRun,
        includePartialMessages: true,
        appendSystemPrompt: NO_SHELL,
        disallowedTools: ['bash'],
      }) as AsyncIterable<SDKMessage>
  }, [llm, settings.model])

  const listDir = useCallback(async (dir: string) => (await fs.readdir(dir)) ?? [], [])

  const openFile = useCallback(async (path: string) => {
    setOpenPath(path)
    try {
      setContent((await fs.readFile(path)) ?? '')
    } catch {
      setContent('(unreadable)')
    }
  }, [])

  const save = useCallback(async () => {
    if (!openPath) return
    await fs.writeFile(openPath, content)
    setRefreshKey((k) => k + 1)
  }, [openPath, content])

  return (
    <div className="app">
      <header className="bar">
        <span className="brand">◆ anyclaude · file tools on your IndexedDB</span>
        <span className="sub">DB: <code>{DB_NAME}</code> · durable across reloads</span>
        <button className="cfg-btn" onClick={() => setShowSettings((s) => !s)}>
          {showSettings ? 'Hide' : 'LLM settings'}
        </button>
      </header>

      {showSettings && (
        <div className="settings">
          <p className="hint">
            The agent loop runs in this tab, so it calls the LLM directly — use a <b>CORS-enabled</b> OpenAI/Anthropic-compatible
            endpoint. (Kilo's gateway is server-only / no browser CORS — for Kilo use the <code>vercel-clienttools</code> example.)
          </p>
          <div className="fields">
            <label>Endpoint<input value={settings.endpoint} placeholder="https://api.example.com/v1"
              onChange={(e) => setSettings((s) => ({ ...s, endpoint: e.target.value.trim() }))} /></label>
            <label>Model<input value={settings.model} placeholder="gpt-4o-mini"
              onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value.trim() }))} /></label>
            <label>API key<input type="password" value={settings.apiKey} placeholder="sk-… (optional for keyless)"
              onChange={(e) => setSettings((s) => ({ ...s, apiKey: e.target.value }))} /></label>
          </div>
        </div>
      )}

      <div className="body">
        <FileExplorer list={listDir} root="/" openPath={openPath} onOpen={openFile} refreshKey={refreshKey} className="files" />
        <div className="center">
          <div className="editor-bar">
            <span>{openPath ?? 'Select a file the agent created'}</span>
            <button onClick={save} disabled={!openPath}>Save</button>
          </div>
          <CodeEditor value={content} onChange={setContent} className="editor" />
        </div>
        {run ? (
          <ChatPanel run={run} title="Agent" className="chat" placeholder="e.g. create src/index.js with a hello function…" />
        ) : (
          <div className="chat notice">
            <p>Set a CORS-enabled LLM endpoint + model in <b>LLM settings</b> to start.</p>
            <p className="hint">Files the agent writes land in your IndexedDB and appear in the explorer on the left.</p>
          </div>
        )}
      </div>
    </div>
  )
}
