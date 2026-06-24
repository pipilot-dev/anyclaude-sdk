import { useAgent, Transcript, Composer, Working, renderMarkdown } from 'anyclaude-react'
import 'anyclaude-react/styles.css'
import './app.css'

export default function App() {
  // The endpoint client auto-stitches `paused` boundaries into continuation
  // requests (same sessionId, continueRun:true) — so the serverless function's
  // time cap is invisible: the run just keeps streaming.
  const agent = useAgent({ endpoint: '/api/agent' })
  const { messages, streamingText, status, send } = agent

  return (
    <div className="app">
      <header className="bar">
        <strong>anyclaude-sdk</strong>
        <span className="sub">Vercel serverless · KV survivor</span>
        <span className={`status status-${status}`}>
          {status === 'paused' ? 'paused — continuing in a new request…' : status}
        </span>
      </header>

      <main className="chat">
        <Transcript messages={messages} streamingText={streamingText} renderMarkdown={renderMarkdown} />
        <Working active={status !== 'idle'} paused={status === 'paused'} label="Working" />
      </main>

      <Composer onSend={send} disabled={status === 'running'} placeholder="Ask the agent to do something long…" />
    </div>
  )
}
