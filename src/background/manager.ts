// In-thread background task manager. Runs detached async work (background
// sub-agents, long shell commands) without blocking the main agent loop. Tasks
// are pollable by id; output can stream in via the `append` callback.
//
// This is the core — it requires no worker. For true off-main-thread execution,
// see ./worker.ts (optional, Comlink-based).

export type BgStatus = 'running' | 'completed' | 'failed' | 'stopped'

export interface BgTask {
  id: string
  description: string
  status: BgStatus
  output: string
  error?: string
  startedAt: number
  endedAt?: number
}

/** Work performed by a background task. */
export type BgTaskFn = (
  signal: AbortSignal,
  append: (chunk: string) => void
) => Promise<string>

interface BgEntry {
  task: BgTask
  controller: AbortController
  promise: Promise<void>
}

function now(): number {
  // Read Date.now lazily at runtime (never at module top-level).
  return Date.now()
}

export class BackgroundTaskManager {
  private entries = new Map<string, BgEntry>()
  private counter = 0

  /**
   * Launch `fn` detached and return a task id immediately. The task runs in the
   * background; poll it with get()/output()/list(). Never throws synchronously.
   */
  start(description: string, fn: BgTaskFn): string {
    const id = `bg_${++this.counter}`
    const controller = new AbortController()
    const task: BgTask = {
      id,
      description,
      status: 'running',
      output: '',
      startedAt: now(),
    }

    const append = (chunk: string) => {
      // Ignore writes after the task has settled.
      if (task.status === 'running') task.output += chunk
    }

    const promise = (async () => {
      try {
        const final = await fn(controller.signal, append)
        if (task.status !== 'running') return // already stopped
        // Append the final result unless it was already streamed via `append`.
        if (final && !task.output.trimEnd().endsWith(final.trimEnd())) {
          task.output += (task.output ? '\n' : '') + final
        }
        task.status = 'completed'
      } catch (err) {
        if (task.status === 'stopped') return
        if (controller.signal.aborted) {
          task.status = 'stopped'
        } else {
          task.status = 'failed'
          task.error = err instanceof Error ? err.message : String(err)
        }
      } finally {
        task.endedAt = now()
      }
    })()

    this.entries.set(id, { task, controller, promise })
    return id
  }

  get(id: string): BgTask | undefined {
    return this.entries.get(id)?.task
  }

  list(): BgTask[] {
    return [...this.entries.values()].map((e) => e.task)
  }

  /** Return a task's output, optionally sliced from a char offset. */
  output(id: string, opts?: { since?: number }): string | null {
    const entry = this.entries.get(id)
    if (!entry) return null
    const out = entry.task.output
    return opts?.since ? out.slice(opts.since) : out
  }

  /** Abort a running task. Returns false if there is no such running task. */
  stop(id: string): boolean {
    const entry = this.entries.get(id)
    if (!entry) return false
    if (entry.task.status === 'running') {
      entry.task.status = 'stopped'
      entry.task.endedAt = now()
      try {
        entry.controller.abort()
      } catch {
        /* ignore */
      }
      return true
    }
    return false
  }

  stopAll(): void {
    for (const id of this.entries.keys()) this.stop(id)
  }

  /** Await settlement of a task (resolves regardless of outcome). */
  async wait(id: string): Promise<BgTask | undefined> {
    const entry = this.entries.get(id)
    if (!entry) return undefined
    await entry.promise
    return entry.task
  }
}
