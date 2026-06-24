import { useAgent, Transcript, Composer, Working } from 'anyclaude-react'

// Talks to the /api/agent serverless function. useAgent's endpoint client
// auto-stitches `paused` continuations (same sessionId, continueRun) — so when
// the function hits MAX_DURATION_MS and pauses, the client transparently
// continues in a fresh invocation and you see one seamless conversation.
export function App() {
  const agent = useAgent({ endpoint: '/api/agent' })

  return (
    <div className="app">
      <header className="bar">
        <strong>anyclaude · Vercel + Supabase survivor</strong>
        <span className={`status status-${agent.status}`}>
          {agent.status === 'paused'
            ? '⟳ continuing (survived a function pause)'
            : agent.status === 'running'
              ? 'running…'
              : 'idle'}
          {agent.tokens ? ` · ${agent.tokens.toLocaleString()} tok` : ''}
        </span>
      </header>

      <Transcript messages={agent.messages} streamingText={agent.streamingText} />
      <Working active={agent.status !== 'idle'} paused={agent.status === 'paused'} label="Working" />
      <Composer onSend={agent.send} placeholder="Ask for a long, multi-step task to see the survivor span the limit…" />
    </div>
  )
}
