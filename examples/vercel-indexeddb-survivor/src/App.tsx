import { useMemo, useRef, useState } from 'react'
import { MarkdownMessage } from 'anyclaude-react'
import 'anyclaude-react/styles.css'
import { createIdbAgentClient, type AnyMessage, type Status } from './agentClient'

interface Entry {
  id: string
  role: 'user' | 'assistant' | 'tool'
  text?: string
  tool?: string
  result?: string
}

export function App() {
  const client = useMemo(() => createIdbAgentClient(), [])
  const [entries, setEntries] = useState<Entry[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [input, setInput] = useState('')
  const streamingId = useRef<string | null>(null)

  const upsert = (e: Entry) => setEntries((prev) => {
    const i = prev.findIndex((x) => x.id === e.id)
    if (i < 0) return [...prev, e]
    const next = prev.slice()
    next[i] = e
    return next
  })

  function onMessage(m: AnyMessage) {
    if (m.type === 'stream_event') {
      const ev = m.event as { type?: string; delta?: { type?: string; text?: string } } | undefined
      if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
        if (!streamingId.current) streamingId.current = 'a-' + Math.random().toString(36).slice(2)
        const id = streamingId.current
        setEntries((prev) => {
          const i = prev.findIndex((x) => x.id === id)
          const text = (i >= 0 ? prev[i].text ?? '' : '') + (ev.delta!.text ?? '')
          const e: Entry = { id, role: 'assistant', text }
          if (i < 0) return [...prev, e]
          const next = prev.slice(); next[i] = e; return next
        })
      }
      return
    }
    if (m.type === 'assistant') {
      const content = (m.message as { content?: Array<Record<string, unknown>> })?.content ?? []
      for (const b of content) {
        if (b.type === 'text' && typeof b.text === 'string' && (b.text as string).trim()) {
          const id = streamingId.current ?? 'a-' + Math.random().toString(36).slice(2)
          upsert({ id, role: 'assistant', text: b.text as string })
        } else if (b.type === 'tool_use') {
          upsert({ id: String(b.id), role: 'tool', tool: String(b.name) })
        }
      }
      streamingId.current = null
      return
    }
    if (m.type === 'user' && (m as { isSynthetic?: boolean }).isSynthetic) {
      const content = (m.message as { content?: Array<Record<string, unknown>> })?.content ?? []
      for (const b of content) {
        if (b.type === 'tool_result') {
          const txt = typeof b.content === 'string' ? (b.content as string) : '[…]'
          upsert({ id: String(b.tool_use_id), role: 'tool', result: txt.split('\n')[0].slice(0, 120) })
        }
      }
    }
  }

  async function send() {
    const t = input.trim()
    if (!t || status !== 'idle') return
    setInput('')
    setEntries((prev) => [...prev, { id: 'u-' + Date.now(), role: 'user', text: t }])
    await client.send(t, onMessage, setStatus)
  }

  return (
    <div className="wrap">
      <header>
        <h1>anyclaude · IndexedDB + stateless serverless survivor</h1>
        <span className={`badge ${status}`}>{status}</span>
      </header>
      <p className="sub">
        The transcript lives in your browser's <b>IndexedDB</b>; the Vercel function is <b>stateless</b>. When it
        hits its time budget it pauses, and the client transparently re-sends the saved transcript to continue —
        so long agents run on a free serverless tier with <b>no database</b>.
      </p>

      <div className="transcript">
        {entries.map((e) =>
          e.role === 'tool' ? (
            <div key={e.id} className="tool">
              <span className="pill">▸ {e.tool ?? 'tool'}</span>
              {e.result && <span className="result"> ⮑ {e.result}</span>}
            </div>
          ) : e.role === 'assistant' ? (
            // streamdown markdown (headings, lists, code, links) via the kit
            <MarkdownMessage key={e.id} text={e.text ?? ''} />
          ) : (
            <div key={e.id} className={`msg ${e.role}`}>
              <b>you</b>
              <div>{e.text}</div>
            </div>
          )
        )}
        {status !== 'idle' && (
          <div className="working">
            <span className="dot" /> {status === 'paused' ? 'continuing in a fresh request…' : 'working…'}
          </div>
        )}
      </div>

      <div className="composer">
        <input
          value={input}
          placeholder="Ask the agent something long-running…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          disabled={status !== 'idle'}
        />
        <button onClick={send} disabled={status !== 'idle' || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  )
}
