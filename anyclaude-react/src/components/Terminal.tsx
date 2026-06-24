import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

/** A live shell process (structurally compatible with a WebContainer process). */
export interface ShellProcess {
  output: ReadableStream<string>
  input: WritableStream<string>
  resize?(size: { cols: number; rows: number }): void
  kill?(): void
}

export interface TerminalProps {
  /** Spawn a shell process for the given terminal size (e.g. wc.spawn('jsh', {terminal})). */
  spawn: (size: { cols: number; rows: number }) => Promise<ShellProcess>
  className?: string
  /** Header label; pass null to hide the header. */
  title?: string | null
  fontSize?: number
}

/**
 * An interactive xterm.js terminal bound to a streaming shell process. Backend-
 * agnostic — pass any `spawn` that returns a {output, input, resize?, kill?}.
 * Requires the optional peer deps `@xterm/xterm` + `@xterm/addon-fit`.
 */
export function Terminal({ spawn, className, title = 'Terminal', fontSize = 13 }: TerminalProps) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!hostRef.current) return
    let disposed = false
    let shell: ShellProcess | null = null
    let writer: WritableStreamDefaultWriter<string> | null = null

    const term = new XTerm({
      convertEol: true,
      cursorBlink: true,
      fontSize,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      theme: { background: '#0b0e14', foreground: '#cbd5e1' },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)

    const safeFit = () => {
      const el = hostRef.current
      if (!el || el.clientWidth === 0 || el.clientHeight === 0) return
      try {
        fit.fit()
        shell?.resize?.({ cols: term.cols, rows: term.rows })
      } catch {
        /* not ready */
      }
    }
    const raf = requestAnimationFrame(safeFit)

    void (async () => {
      shell = await spawn({ cols: term.cols, rows: term.rows })
      if (disposed) {
        shell.kill?.()
        return
      }
      shell.output
        .pipeTo(new WritableStream({ write: (chunk) => term.write(chunk) }))
        .catch(() => {})
      writer = shell.input.getWriter()
      term.onData((d) => void writer?.write(d))
    })()

    const ro = new ResizeObserver(() => safeFit())
    ro.observe(hostRef.current)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      try {
        writer?.releaseLock()
      } catch {
        /* ignore */
      }
      shell?.kill?.()
      term.dispose()
    }
  }, [spawn, fontSize])

  return (
    <div className={`ac-terminal${className ? ' ' + className : ''}`}>
      {title !== null && <div className="ac-terminal-head">{title}</div>}
      <div className="ac-terminal-host" ref={hostRef} />
    </div>
  )
}
