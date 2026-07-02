import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { WebContainer } from '@webcontainer/api'
import { FileExplorer, useWebContainerPreview, useAgent, Transcript, Composer, Working, type WebContainerLike } from 'anyclaude-react'
import { Terminal, CodeEditor } from 'anyclaude-react/ide'
import 'anyclaude-react/styles.css'
import { query } from 'anyclaude-sdk/query'
import { createOpenAIClient } from 'anyclaude-sdk/llm'
import { WebContainerWorkspace } from 'anyclaude-sdk/workspace'
import { starterFiles } from './starter'

// Custom SVG Icons for a premium look
const IconSettings = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
)

const IconFile = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
    <polyline points="14 2 14 8 20 8"/>
  </svg>
)

const IconTerminal = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 17 10 11 4 5"/>
    <line x1="12" y1="19" x2="20" y2="19"/>
  </svg>
)

const IconRefresh = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
  </svg>
)

const IconPower = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10"/>
  </svg>
)

const IconExternal = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/>
  </svg>
)

const IconLock = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6, color: '#10b981' }}>
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>
)

const IconEye = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
)

const IconEyeOff = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
)

const IconClose = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)

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

interface CustomChatPanelProps {
  run: (opts: { prompt: string; sessionId: string }) => any;
  title: React.ReactNode;
  placeholder?: string;
}

function CustomChatPanel({ run, title, placeholder }: CustomChatPanelProps) {
  const { messages, streamingText, status, tokens, cost, send, interrupt, clear } = useAgent({ run });
  const running = status !== 'idle';

  return (
    <div className="custom-chatpanel">
      <div className="custom-chatpanel-head">
        <div className="custom-chatpanel-title-group">
          <span className="custom-chatpanel-title">{title}</span>
          <span className="custom-chatpanel-session-id">Active agent session</span>
        </div>
        <div className="custom-chatpanel-actions">
          {running && (
            <button 
              onClick={interrupt} 
              className="chat-action-btn stop-btn" 
              title="Stop Agent execution"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <rect x="4" y="4" width="16" height="16" rx="2" />
              </svg>
              <span>Stop</span>
            </button>
          )}
          {messages.length > 0 && (
            <button 
              onClick={clear} 
              className="chat-action-btn clear-btn" 
              title="Clear conversation"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              <span>Clear</span>
            </button>
          )}
        </div>
      </div>

      <div className="custom-chatpanel-stats-bar">
        <div className="status-indicator">
          <span className={`status-dot ${status}`}></span>
          <span>{status}</span>
        </div>
        {(tokens > 0 || cost > 0) && (
          <div className="stats-group">
            {tokens > 0 && <span className="stat-pill">{tokens.toLocaleString()} tokens</span>}
            {cost > 0 && <span className="stat-pill cost">${cost.toFixed(4)}</span>}
          </div>
        )}
      </div>

      <div className="custom-chatpanel-scroll">
        {messages.length === 0 && !streamingText ? (
          <div className="chat-empty-state">
            <div className="chat-empty-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <h4>AI Builder Assistant</h4>
            <p>Tell the assistant what components or features you want to build, and it will update the workspace sandbox in real-time.</p>
            <div className="chat-suggestions">
              <button onClick={() => send("Add a beautiful dark mode UI toggle")} className="suggestion-pill">
                "Add a dark mode UI toggle"
              </button>
              <button onClick={() => send("Build a simple interactive to-do list component with local storage")} className="suggestion-pill">
                "Build a simple to-do list component"
              </button>
              <button onClick={() => send("Add a responsive layout with sidebar navigation")} className="suggestion-pill">
                "Add a sidebar navigation layout"
              </button>
            </div>
          </div>
        ) : (
          <Transcript messages={messages} streamingText={streamingText} />
        )}
      </div>

      <Working active={running} label="Agent is working..." paused={status === 'paused'} />

      <div className="custom-chatpanel-composer-wrapper">
        <Composer onSend={send} placeholder={placeholder} disabled={running} />
      </div>
    </div>
  );
}

export function App() {
  const [wc, setWc] = useState<WebContainer | null>(null)
  const [bootErr, setBootErr] = useState<string | null>(null)
  const [install, setInstall] = useState<'idle' | 'installing' | 'done' | 'error'>('idle')
  const [installLog, setInstallLog] = useState('')

  // Settings Panel State
  const [showSettings, setShowSettings] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)

  // LLM settings — persisted in localStorage for premium dev experience
  const [baseUrl, setBaseUrl] = useState(() => localStorage.getItem('ac_baseUrl') || 'https://api.openai.com/v1')
  const [model, setModel] = useState(() => localStorage.getItem('ac_model') || 'gpt-4o')
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('ac_apiKey') || '')

  useEffect(() => {
    localStorage.setItem('ac_baseUrl', baseUrl)
  }, [baseUrl])

  useEffect(() => {
    localStorage.setItem('ac_model', model)
  }, [model])

  useEffect(() => {
    localStorage.setItem('ac_apiKey', apiKey)
  }, [apiKey])

  // Editor state.
  const [openPath, setOpenPath] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [explorerKey, setExplorerKey] = useState(0)

  // Layout views state
  const [activeView, setActiveView] = useState<'code' | 'preview'>('code')
  const [explorerCollapsed, setExplorerCollapsed] = useState(false)
  const [terminalCollapsed, setTerminalCollapsed] = useState(false)
  const [terminalMaximized, setTerminalMaximized] = useState(false)
  const [previewTab, setPreviewTab] = useState<'browser' | 'logs'>('browser')

  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  useEffect(() => {
    bootContainer().then(setWc, (e) => setBootErr(e instanceof Error ? e.message : String(e)))
  }, [])

  const { url, status: previewStatus, logs, start, restart } = useWebContainerPreview({
    wc: wc as unknown as WebContainerLike | null,
    autoStart: false,
  })

  // Auto-switch tabs to show logs when installing/booting, and back to browser when ready
  useEffect(() => {
    if (install === 'installing') {
      setPreviewTab('logs')
    } else if (install === 'done' && url) {
      setPreviewTab('browser')
      setActiveView('preview')
    }
  }, [install, url])

  // Install deps once, then start the dev server.
  useEffect(() => {
    if (!wc || install !== 'idle') return
    setInstall('installing')
    ;(async () => {
      try {
        const proc = await wc.spawn('pnpm', ['install'])
        proc.output.pipeTo(new WritableStream({ write: (c) => setInstallLog((p) => (p + c).slice(-8000)) }))
        const code = await proc.exit
        if (code !== 0) throw new Error('pnpm install exited ' + code)
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

  // Get status class for styling the indicator light
  const getStatusClass = () => {
    if (bootErr) return 'error'
    if (!wc) return 'booting'
    if (install === 'installing') return 'installing'
    if (install === 'done') return 'ready'
    if (install === 'error') return 'error'
    return 'booting'
  };

  const getStatusText = () => {
    if (bootErr) return 'boot error'
    if (!wc) return 'booting container…'
    if (install === 'installing') return 'installing dependencies…'
    if (install === 'done') return 'ready'
    if (install === 'error') return 'install failed'
    return 'ready'
  };

  return (
    <div className="app">
      <header className="bar">
        <div className="brand-section">
          <div className="brand-logo">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
          <span className="brand-name">
            anyclaude <span className="brand-slash">//</span> bolt
          </span>
          <div className="status-pill">
            <span className={`status-dot ${getStatusClass()}`}></span>
            <span>{getStatusText()}</span>
          </div>
        </div>

        {/* View switcher: Code vs Preview tab buttons */}
        <div className="view-switcher-pill">
          <button 
            className={`view-tab-btn ${activeView === 'code' ? 'active' : ''}`}
            onClick={() => setActiveView('code')}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 6 }}>
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
            Code
          </button>
          <button 
            className={`view-tab-btn ${activeView === 'preview' ? 'active' : ''}`}
            onClick={() => setActiveView('preview')}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 6 }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            Preview
            {install === 'done' && url && <span className="preview-indicator-dot"></span>}
          </button>
        </div>

        <div className="actions-section">
          <button 
            className={`settings-toggle-btn ${showSettings ? 'active' : ''}`}
            onClick={() => setShowSettings(!showSettings)}
          >
            <IconSettings />
            <span>AI Provider Config</span>
          </button>
        </div>

        {showSettings && (
          <div className="settings-popover">
            <h4 className="settings-popover-title">AI Provider Config</h4>
            <p className="settings-popover-desc">
              Change the API endpoint, model, and key. Changes save locally in your browser.
            </p>
            
            <div className="settings-field">
              <label>API base url</label>
              <input 
                value={baseUrl} 
                onChange={(e) => setBaseUrl(e.target.value)} 
                placeholder="https://api.openai.com/v1" 
              />
            </div>

            <div className="settings-field">
              <label>Model Name</label>
              <input 
                value={model} 
                onChange={(e) => setModel(e.target.value)} 
                placeholder="gpt-4o" 
              />
            </div>

            <div className="settings-field">
              <label>API Key</label>
              <div className="settings-input-wrapper">
                <input 
                  value={apiKey} 
                  onChange={(e) => setApiKey(e.target.value)} 
                  placeholder="sk-..." 
                  type={showApiKey ? 'text' : 'password'} 
                />
                <button 
                  type="button" 
                  className="eye-btn"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? <IconEyeOff /> : <IconEye />}
                </button>
              </div>
            </div>

            <button 
              className="settings-close-btn"
              onClick={() => setShowSettings(false)}
            >
              Apply & Close
            </button>
          </div>
        )}
      </header>

      <main className="grid">
        <section className="chat">
          {workspace ? (
            <CustomChatPanel run={run} title="Builder Agent" placeholder="Ask me to build something…" />
          ) : (
            <div className="welcome-welcome" style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
              <div className="spinner" style={{ margin: '40px auto 20px' }}></div>
              <p style={{ fontSize: 13 }}>Initializing the local container...</p>
            </div>
          )}
        </section>

        {/* Content Pane: Switchable between Code and Preview */}
        <section className="content-pane">
          {activeView === 'code' ? (
            /* Code Workspace: Activity Bar + Sidebar Explorer + Editor + Terminal */
            <div className="code-workspace-container">
              {/* Activity Bar (VS Code style far left strip) */}
              <div className="activity-bar">
                <button 
                  className={`activity-btn ${!explorerCollapsed ? 'active' : ''}`}
                  onClick={() => setExplorerCollapsed(!explorerCollapsed)}
                  title="Toggle File Explorer (Sidebar)"
                >
                  <IconFile />
                </button>
                <button 
                  className={`activity-btn ${!terminalCollapsed ? 'active' : ''}`}
                  onClick={() => {
                    setTerminalCollapsed(!terminalCollapsed);
                    setTerminalMaximized(false);
                  }}
                  title="Toggle Terminal"
                >
                  <IconTerminal />
                </button>
                
                {/* Decorative icons for professional IDE look */}
                <div className="activity-spacer"></div>
                <button className="activity-btn decorative" title="Search Code">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                </button>
                <button className="activity-btn decorative" title="Source Control (Git)">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 15V9a4 4 0 0 0-4-4H9"/><line x1="6" y1="9" x2="6" y2="15"/>
                  </svg>
                </button>
                <button className="activity-btn decorative" title="Extensions">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
                  </svg>
                </button>
              </div>

              {/* Sidebar Explorer */}
              <div className="explorer-sidebar" style={{ display: explorerCollapsed ? 'none' : 'flex' }}>
                <div className="explorer-header">
                  <span>Explorer</span>
                  <button 
                    onClick={() => setExplorerCollapsed(true)} 
                    className="explorer-close-btn"
                    title="Collapse sidebar"
                  >
                    <IconClose />
                  </button>
                </div>
                <div className="explorer-sidebar-content" style={{ flex: 1, overflow: 'auto' }}>
                  <FileExplorer key={explorerKey} list={listDir} root={CWD} onOpen={openFile} openPath={openPath ?? undefined} />
                </div>
              </div>

              {/* Editor + Terminal Flex Container */}
              <div className="editor-and-terminal-container">
                <div className="editor-panel" style={{ display: terminalMaximized ? 'none' : 'block' }}>
                  {openPath ? (
                    <div className="editor-container">
                      <div className="editor-tab-bar">
                        <div className="editor-tab">
                          <IconFile />
                          <span>{openPath.split('/').pop()}</span>
                          <span className="file-path">{openPath}</span>
                        </div>
                      </div>
                      <CodeEditor value={code} onChange={saveCode} language={langFor(openPath)} />
                    </div>
                  ) : (
                    <div className="editor-welcome">
                      <div className="welcome-content">
                        <div className="welcome-logo">
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="16 18 22 12 16 6" />
                            <polyline points="8 6 2 12 8 18" />
                          </svg>
                        </div>
                        <h3>anyclaude workspace</h3>
                        <p>Select a file from the explorer sidebar to view/edit, or ask the AI agent on the left to write some code.</p>
                        <div className="welcome-shortcuts">
                          <div className="shortcut-item">
                            <span className="shortcut-label">Active Sandbox Port</span>
                            <span className="shortcut-value">localhost:3000</span>
                          </div>
                          <div className="shortcut-item">
                            <span className="shortcut-label">Dev Command</span>
                            <span className="shortcut-value">npm run dev</span>
                          </div>
                          <div className="shortcut-item">
                            <span className="shortcut-label">Preview Tab</span>
                            <span className="shortcut-value">Toggle above</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Collapsible VS Code style Terminal Drawer */}
                <div 
                  className="terminal-panel" 
                  style={{ 
                    height: terminalCollapsed ? '35px' : terminalMaximized ? '100%' : '240px',
                    flex: terminalMaximized ? 1 : 'none'
                  }}
                >
                  <div className="terminal-tab-bar">
                    <div className="terminal-tabs">
                      <div className="terminal-tab active">
                        <IconTerminal />
                        <span>jsh Terminal</span>
                      </div>
                      <div className="terminal-tab inactive">
                        <span>Output</span>
                      </div>
                      <div className="terminal-tab inactive">
                        <span>Problems</span>
                      </div>
                    </div>
                    <div className="terminal-actions-group">
                      {/* Minimize / Collapse */}
                      <button 
                        onClick={() => {
                          setTerminalCollapsed(!terminalCollapsed);
                          setTerminalMaximized(false);
                        }} 
                        className="terminal-action-btn"
                        title={terminalCollapsed ? 'Expand Terminal' : 'Collapse Terminal'}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          {terminalCollapsed ? <path d="m18 15-6-6-6 6"/> : <path d="m6 9 6 6 6-6"/>}
                        </svg>
                      </button>
                      {/* Maximize Toggle */}
                      {!terminalCollapsed && (
                        <button 
                          onClick={() => setTerminalMaximized(!terminalMaximized)} 
                          className="terminal-action-btn"
                          title={terminalMaximized ? 'Restore Terminal Size' : 'Maximize Terminal'}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            {terminalMaximized ? (
                              <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7" />
                            ) : (
                              <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
                            )}
                          </svg>
                        </button>
                      )}
                      {/* Close Terminal Drawer completely */}
                      <button 
                        onClick={() => {
                          setTerminalCollapsed(true);
                          setTerminalMaximized(false);
                        }} 
                        className="terminal-action-btn"
                        title="Close Panel"
                      >
                        <IconClose />
                      </button>
                    </div>
                  </div>
                  
                  {/* Keep terminal DOM alive to maintain shell state, hide with display: none */}
                  <div 
                    className="terminal-content-area"
                    style={{ display: terminalCollapsed ? 'none' : 'block', height: 'calc(100% - 35px)' }}
                  >
                    {wc ? <Terminal spawn={(size) => wc.spawn('jsh', { terminal: size })} /> : null}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Preview Pane (Mock Browser Viewport) */
            <div className="preview" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div className="browser-frame">
                <div className="browser-bar">
                  <div className="browser-dots">
                    <span className="browser-dot red"></span>
                    <span className="browser-dot yellow"></span>
                    <span className="browser-dot green"></span>
                  </div>

                  <div className="browser-address-container">
                    <IconLock />
                    <div className="browser-address">
                      {url ? url.replace(/^https?:\/\//, '') : 'localhost:3000 (starting dev server…)'}
                    </div>
                    {url && (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="browser-external-link" title="Open in new tab">
                        <IconExternal />
                      </a>
                    )}
                  </div>

                  <div className="browser-actions">
                    <button onClick={refresh} disabled={!url} className="browser-btn" title="Reload preview">
                      <IconRefresh />
                    </button>
                    <button onClick={() => restart()} disabled={install !== 'done'} className="browser-btn restart-btn" title="Restart dev server">
                      <IconPower />
                    </button>
                  </div>
                </div>

                <div className="browser-tab-nav">
                  <button 
                    className={`browser-tab-button ${previewTab === 'browser' ? 'active' : ''}`}
                    onClick={() => setPreviewTab('browser')}
                  >
                    App Preview
                  </button>
                  <button 
                    className={`browser-tab-button ${previewTab === 'logs' ? 'active' : ''}`}
                    onClick={() => setPreviewTab('logs')}
                  >
                    Server Output
                  </button>
                </div>

                <div className={`browser-viewport ${previewTab === 'logs' ? 'tab-logs' : ''}`}>
                  {previewTab === 'browser' ? (
                    url ? (
                      <iframe ref={iframeRef} src={url} title="preview" />
                    ) : (
                      <div className="logs-placeholder">
                        <div className="spinner"></div>
                        <span style={{ fontSize: 13 }}>Waiting for Vite dev server to start on port 3000...</span>
                      </div>
                    )
                  ) : (
                    <pre className="logs-container">
                      {install === 'installing' ? installLog || 'Installing dependencies…' : logs || 'Dev server starting…'}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

