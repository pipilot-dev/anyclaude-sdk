// React hook driving an agent run with live streaming + survivor stitching.
import { useCallback, useMemo, useRef, useState } from 'react'
import type { SDKMessage } from 'anyclaude-sdk'
import { createAgentClient, createEndpointClient, type AgentClient, type RunFn, type ClientToolMap } from './client.js'

export type AgentStatus = 'idle' | 'running' | 'paused'

export interface UseAgentOptions {
  /** Provide ONE of these. */
  client?: AgentClient
  run?: RunFn
  endpoint?: string
  headers?: Record<string, string>
  /** Host executors for client-side tools (e.g. run `bash` on a WebContainer). */
  clientTools?: ClientToolMap
  /** Stable id for this conversation (survivor continuation reuses it). Auto if omitted. */
  sessionId?: string
}

export interface UseAgentResult {
  messages: SDKMessage[]
  streamingText: string
  status: AgentStatus
  tokens: number
  cost: number
  sessionId: string
  send: (text: string) => void
  interrupt: () => void
  clear: () => void
}

let _seq = 0
function newSessionId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  return c?.randomUUID?.() ?? `sess-${Date.now()}-${++_seq}`
}

function resolveClient(opts: UseAgentOptions): AgentClient {
  if (opts.client) return opts.client
  if (opts.run) return createAgentClient({ run: opts.run, clientTools: opts.clientTools })
  if (opts.endpoint) return createEndpointClient({ endpoint: opts.endpoint, headers: opts.headers, clientTools: opts.clientTools })
  throw new Error('useAgent: provide one of `client`, `run`, or `endpoint`.')
}

export function useAgent(opts: UseAgentOptions): UseAgentResult {
  const [messages, setMessages] = useState<SDKMessage[]>([])
  const [streamingText, setStreamingText] = useState('')
  const [status, setStatus] = useState<AgentStatus>('idle')
  const [tokens, setTokens] = useState(0)
  const [cost, setCost] = useState(0)

  const sessionRef = useRef<string>(opts.sessionId ?? newSessionId())
  const abortRef = useRef(false)
  const runningRef = useRef(false)

  const client = useMemo(
    () => resolveClient(opts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opts.client, opts.run, opts.endpoint, opts.headers, opts.clientTools]
  )

  const send = useCallback(
    (text: string) => {
      const t = text.trim()
      if (!t || runningRef.current) return
      runningRef.current = true
      abortRef.current = false
      const userMsg = {
        type: 'user',
        message: { role: 'user', content: t },
        parent_tool_use_id: null,
      } as unknown as SDKMessage
      setMessages((m) => [...m, userMsg])
      setStatus('running')
      setStreamingText('')

      void (async () => {
        let buf = ''
        try {
          for await (const msg of client.send(t, sessionRef.current)) {
            if (abortRef.current) break
            if (msg.type === 'stream_event') {
              const ev = (msg as { event?: { type?: string; delta?: { type?: string; text?: string } } }).event
              if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
                buf += ev.delta.text ?? ''
                setStreamingText(buf)
              }
              continue
            }
            const sub = (msg as { subtype?: string }).subtype
            if (msg.type === 'system' && sub === 'paused') {
              setStatus('paused')
              continue
            }
            if (msg.type === 'assistant') {
              buf = ''
              setStreamingText('')
              setStatus('running')
              setMessages((m) => [...m, msg])
              continue
            }
            if (msg.type === 'user') {
              setMessages((m) => [...m, msg])
              continue
            }
            if (msg.type === 'result') {
              const u = (msg as { usage?: { input_tokens?: number; output_tokens?: number } }).usage
              if (u) setTokens((u.input_tokens ?? 0) + (u.output_tokens ?? 0))
              const c = (msg as { total_cost_usd?: number }).total_cost_usd
              if (typeof c === 'number') setCost(c)
              continue
            }
            // system: init / local_command_output / compact_boundary
            setMessages((m) => [...m, msg])
          }
        } catch (err) {
          const errMsg = {
            type: 'system',
            subtype: 'local_command_output',
            content: 'Error: ' + (err instanceof Error ? err.message : String(err)),
          } as unknown as SDKMessage
          setMessages((m) => [...m, errMsg])
        } finally {
          runningRef.current = false
          setStreamingText('')
          setStatus('idle')
        }
      })()
    },
    [client]
  )

  const interrupt = useCallback(() => {
    abortRef.current = true
    runningRef.current = false
    setStatus('idle')
    setStreamingText('')
  }, [])

  const clear = useCallback(() => {
    if (runningRef.current) return
    setMessages([])
    setTokens(0)
    setCost(0)
    sessionRef.current = newSessionId()
  }, [])

  return { messages, streamingText, status, tokens, cost, sessionId: sessionRef.current, send, interrupt, clear }
}
