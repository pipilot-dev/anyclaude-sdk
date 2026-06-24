import { useRef, useState } from 'react'
import {
  query,
  createAnthropicClient,
  type WebContainerWorkspace,
  type SDKMessage,
} from '@browser-claude-sdk/core'

type Item =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; name: string; args: string }
  | { kind: 'tool_result'; text: string; isError?: boolean }
  | { kind: 'system'; text: string }
  | { kind: 'result'; text: string; ok: boolean; cost?: number; tokens?: number }

export function ChatPanel(props: {
  workspace: WebContainerWorkspace
  baseUrl: string
  model: string
  onBaseUrl: (v: string) => void
  onModel: (v: string) => void
  onActivity: () => void
}) {
  const { workspace, baseUrl, model } = props
  const [items, setItems] = useState<Item[]>([])
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // True while we're streaming text deltas into the last assistant bubble.
  const streamingRef = useRef(false)

  const scroll = () => queueMicrotask(() => listRef.current?.scrollTo({ top: 1e9 }))

  const push = (it: Item) => {
    setItems((prev) => [...prev, it])
    scroll()
  }

  // Append a streamed text delta to the live assistant bubble (creating it on
  // the first delta of a turn).
  const appendDelta = (delta: string) => {
    setItems((prev) => {
      if (streamingRef.current) {
        const last = prev[prev.length - 1]
        if (last && last.kind === 'assistant') {
          const copy = prev.slice()
          copy[copy.length - 1] = { ...last, text: last.text + delta }
          return copy
        }
      }
      streamingRef.current = true
      return [...prev, { kind: 'assistant', text: delta }]
    })
    scroll()
  }

  async function send() {
    const text = input.trim()
    if (!text || running) return
    setInput('')
    push({ kind: 'user', text })
    setRunning(true)

    const abort = new AbortController()
    abortRef.current = abort
    const llm = createAnthropicClient({ baseUrl, model })

    // Stream one query() per message; the workspace (WebContainer) persists
    // across messages so files and state carry over.
    streamingRef.current = false
    try {
      for await (const msg of query({
        prompt: text,
        workspace,
        llm,
        model,
        background: true,
        agents: {},
        maxTurns: 24,
        includePartialMessages: true,
        abortController: abort,
      }) as AsyncGenerator<SDKMessage>) {
        if (msg.type === 'stream_event') {
          // Live token delta → grow the current assistant bubble.
          if (msg.event.type === 'content_block_delta' && msg.event.delta.type === 'text_delta') {
            appendDelta(msg.event.delta.text)
          }
        } else if (msg.type === 'assistant') {
          for (const b of msg.message.content) {
            if (b.type === 'text' && b.text.trim()) {
              if (streamingRef.current) {
                // Finalize the streamed bubble with the authoritative text.
                setItems((prev) => {
                  const last = prev[prev.length - 1]
                  if (last && last.kind === 'assistant') {
                    const copy = prev.slice()
                    copy[copy.length - 1] = { kind: 'assistant', text: b.text }
                    return copy
                  }
                  return [...prev, { kind: 'assistant', text: b.text }]
                })
              } else {
                push({ kind: 'assistant', text: b.text })
              }
            } else if (b.type === 'tool_use')
              push({ kind: 'tool', name: b.name, args: preview(b.input) })
          }
          // The assistant turn is over; the next turn starts a fresh bubble.
          streamingRef.current = false
        } else if (msg.type === 'user' && msg.isSynthetic) {
          for (const b of msg.message.content) {
            if (b.type === 'tool_result') {
              const t = typeof b.content === 'string' ? b.content : describeBlocks(b.content)
              push({ kind: 'tool_result', text: t, isError: b.is_error })
            }
          }
        } else if (msg.type === 'system' && msg.subtype === 'local_command_output') {
          push({ kind: 'system', text: msg.content })
        } else if (msg.type === 'result') {
          const ok = msg.subtype === 'success'
          // Success: a compact status/cost footer only — the assistant text is
          // already shown above, so don't repeat it. Error: surface the errors.
          push({
            kind: 'result',
            ok,
            text: ok ? '' : msg.errors.join('; '),
            cost: msg.total_cost_usd,
            tokens: msg.usage ? msg.usage.input_tokens + msg.usage.output_tokens : undefined,
          })
        }
      }
    } catch (e) {
      push({ kind: 'system', text: `Error: ${(e as Error)?.message ?? e}` })
    } finally {
      setRunning(false)
      abortRef.current = null
      props.onActivity() // refresh file tree after the run
      void assistantIdx
    }
  }

  return (
    <div className="chat">
      <div className="chat-settings">
        <input
          className="cfg"
          value={baseUrl}
          onChange={(e) => props.onBaseUrl(e.target.value)}
          placeholder="base URL"
          spellCheck={false}
        />
        <input
          className="cfg model"
          value={model}
          onChange={(e) => props.onModel(e.target.value)}
          placeholder="model"
          spellCheck={false}
        />
      </div>

      <div className="messages" ref={listRef}>
        {items.map((it, i) => (
          <Message key={i} item={it} />
        ))}
        {!items.length && (
          <div className="empty">
            Ask the agent to build something — e.g. “create an express server in
            src/server.js and run it”.
          </div>
        )}
      </div>

      <div className="composer">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          placeholder="Message the agent…  (Enter to send, Shift+Enter for newline)"
          rows={3}
        />
        {running ? (
          <button className="stop" onClick={() => abortRef.current?.abort()}>
            Interrupt
          </button>
        ) : (
          <button className="send" onClick={() => void send()} disabled={!input.trim()}>
            Send
          </button>
        )}
      </div>
    </div>
  )
}

function Message({ item }: { item: Item }) {
  switch (item.kind) {
    case 'user':
      return <div className="msg user">{item.text}</div>
    case 'assistant':
      return <div className="msg assistant">{item.text}</div>
    case 'tool':
      return (
        <div className="msg tool">
          ▸ <b>{item.name}</b>
          <span className="args">({item.args})</span>
        </div>
      )
    case 'tool_result':
      return (
        <details className={'msg tool-result' + (item.isError ? ' err' : '')}>
          <summary>{item.isError ? '✗ result' : '✓ result'}</summary>
          <pre>{item.text}</pre>
        </details>
      )
    case 'system':
      return <div className="msg system">{item.text}</div>
    case 'result':
      return (
        <div className={'msg result' + (item.ok ? '' : ' err')}>
          {item.ok ? '✓ done' : `✗ ${item.text}`}
          {item.tokens != null && (
            <span className="meta">
              {' · '}
              {item.tokens.toLocaleString()} tok
              {item.cost != null && ` · $${item.cost.toFixed(4)}`}
            </span>
          )}
        </div>
      )
  }
}

function preview(input: Record<string, unknown>): string {
  const s = JSON.stringify(input)
  return s.length > 80 ? s.slice(0, 80) + '…' : s
}

function describeBlocks(blocks: Array<{ type: string }>): string {
  return blocks
    .map((b) => (b.type === 'text' ? (b as { text: string }).text : `[${b.type}]`))
    .join('\n')
}
