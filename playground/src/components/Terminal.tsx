import { useEffect, useRef } from 'react'
import type { WebContainer, WebContainerProcess } from '@webcontainer/api'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

export function TerminalView({ wc }: { wc: WebContainer }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!hostRef.current) return
    let disposed = false
    let shell: WebContainerProcess | null = null
    let writer: WritableStreamDefaultWriter<string> | null = null

    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      theme: { background: '#0b0e14', foreground: '#cbd5e1' },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)

    // Only fit when the host actually has layout dimensions — fitting a
    // zero-size element makes xterm compute undefined dimensions and throw.
    const safeFit = () => {
      const el = hostRef.current
      if (!el || el.clientWidth === 0 || el.clientHeight === 0) return
      try {
        fit.fit()
        shell?.resize({ cols: term.cols, rows: term.rows })
      } catch {
        /* not ready yet */
      }
    }
    // Defer the first fit until after layout has flushed.
    const raf = requestAnimationFrame(safeFit)

    ;(async () => {
      shell = await wc.spawn('jsh', {
        terminal: { cols: term.cols, rows: term.rows },
      })
      if (disposed) {
        shell.kill()
        return
      }
      shell.output.pipeTo(
        new WritableStream({
          write(chunk) {
            term.write(chunk)
          },
        })
      ).catch(() => {})
      writer = shell.input.getWriter()
      term.onData((d) => writer?.write(d))
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
      shell?.kill()
      term.dispose()
    }
  }, [wc])

  return (
    <div className="terminal">
      <div className="terminal-head">Terminal · jsh</div>
      <div className="terminal-host" ref={hostRef} />
    </div>
  )
}
