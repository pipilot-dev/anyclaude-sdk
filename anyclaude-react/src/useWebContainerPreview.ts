// useWebContainerPreview — boot a dev server inside a WebContainer and get back
// a live preview URL. This is the fiddly part of building an in-browser IDE
// ("bolt clone"): spawn `npm run dev`, wait for the container's `server-ready`
// event, surface the forwarded URL for an <iframe>, stream logs, and clean up
// the process on unmount / restart.
//
// Structurally typed against @webcontainer/api so the package keeps no hard peer
// dependency — pass a booted `WebContainer` and it just works.
import { useCallback, useEffect, useRef, useState } from 'react'

/** Minimal structural shape of a booted WebContainer (subset we use). */
export interface WebContainerLike {
  /** Fires when a server inside the container starts listening. Returns an unsubscribe fn. */
  on(event: 'server-ready', listener: (port: number, url: string) => void): () => void
  /** Spawn a process; returns something with a streamed `output` and an `exit` promise. */
  spawn(
    command: string,
    args?: string[],
    options?: Record<string, unknown>
  ): Promise<WebContainerProcessLike>
}

export interface WebContainerProcessLike {
  output?: ReadableStream<string>
  exit: Promise<number>
  kill?: () => void
}

export type PreviewStatus = 'idle' | 'starting' | 'ready' | 'exited' | 'error'

export interface UseWebContainerPreviewOptions {
  /** A booted WebContainer (or null until it's ready). */
  wc: WebContainerLike | null
  /** Command to start the dev server. Default `'npm'`. */
  command?: string
  /** Args for the command. Default `['run', 'dev']`. */
  args?: string[]
  /** Start automatically once `wc` is available. Default `false` (call `start()`). */
  autoStart?: boolean
  /** Spawn options forwarded to `wc.spawn` (e.g. `{ cwd, env }`). */
  spawnOptions?: Record<string, unknown>
  /** Max log characters to retain (ring-buffered). Default 20000. */
  maxLogChars?: number
  /** Called with the preview URL once the server is ready. */
  onReady?: (url: string, port: number) => void
}

export interface UseWebContainerPreviewResult {
  /** The forwarded preview URL once the dev server is up — feed to an <iframe src>. */
  url: string | null
  /** The port the server bound to inside the container. */
  port: number | null
  status: PreviewStatus
  /** Accumulated stdout/stderr from the dev-server process. */
  logs: string
  error: string | null
  /** Spawn the dev server (no-op if already running). */
  start: () => Promise<void>
  /** Kill the dev-server process and reset to idle. */
  stop: () => void
  /** Stop then start again. */
  restart: () => Promise<void>
}

/**
 * Run a dev server in a WebContainer and expose its live preview URL.
 *
 *   const { url, status, start } = useWebContainerPreview({ wc, autoStart: true })
 *   return url ? <iframe src={url} /> : <p>{status}…</p>
 */
export function useWebContainerPreview(
  opts: UseWebContainerPreviewOptions
): UseWebContainerPreviewResult {
  const { wc, command = 'npm', args = ['run', 'dev'], autoStart = false, spawnOptions, maxLogChars = 20000, onReady } = opts

  const [url, setUrl] = useState<string | null>(null)
  const [port, setPort] = useState<number | null>(null)
  const [status, setStatus] = useState<PreviewStatus>('idle')
  const [logs, setLogs] = useState('')
  const [error, setError] = useState<string | null>(null)

  const procRef = useRef<WebContainerProcessLike | null>(null)
  const readerRef = useRef<ReadableStreamDefaultReader<string> | null>(null)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  // Subscribe to server-ready for the lifetime of `wc`.
  useEffect(() => {
    if (!wc) return
    const off = wc.on('server-ready', (p, u) => {
      setPort(p)
      setUrl(u)
      setStatus('ready')
      onReadyRef.current?.(u, p)
    })
    return () => {
      try {
        off?.()
      } catch {
        /* ignore */
      }
    }
  }, [wc])

  const stop = useCallback(() => {
    try {
      readerRef.current?.cancel().catch(() => {})
    } catch {
      /* ignore */
    }
    readerRef.current = null
    try {
      procRef.current?.kill?.()
    } catch {
      /* ignore */
    }
    procRef.current = null
    setStatus('idle')
    setUrl(null)
    setPort(null)
  }, [])

  const start = useCallback(async () => {
    if (!wc || procRef.current) return
    setError(null)
    setLogs('')
    setStatus('starting')
    try {
      const proc = await wc.spawn(command, args, spawnOptions)
      procRef.current = proc

      if (proc.output) {
        const reader = proc.output.getReader()
        readerRef.current = reader
        ;(async () => {
          try {
            for (;;) {
              const { value, done } = await reader.read()
              if (done) break
              if (value)
                setLogs((prev) => {
                  const next = prev + value
                  return next.length > maxLogChars ? next.slice(next.length - maxLogChars) : next
                })
            }
          } catch {
            /* reader cancelled */
          }
        })()
      }

      proc.exit.then(
        (code) => {
          if (procRef.current === proc) {
            procRef.current = null
            setStatus((s) => (s === 'ready' ? 'exited' : code === 0 ? 'exited' : 'error'))
            if (code !== 0) setError(`Dev server exited with code ${code}`)
          }
        },
        () => {}
      )
    } catch (e) {
      setStatus('error')
      setError(e instanceof Error ? e.message : String(e))
      procRef.current = null
    }
  }, [wc, command, args, spawnOptions, maxLogChars])

  const restart = useCallback(async () => {
    stop()
    await start()
  }, [stop, start])

  // Auto-start once the container is available.
  useEffect(() => {
    if (autoStart && wc && !procRef.current && status === 'idle') {
      void start()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, wc])

  // Clean up the process on unmount.
  useEffect(() => () => stop(), [stop])

  return { url, port, status, logs, error, start, stop, restart }
}
