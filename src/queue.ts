// Message queue for interjecting user messages into a LIVE query loop.
//
// While the agent is busy (streaming, running tools across multiple turns), the
// app can `push()` follow-up user messages. The agent drains them ONE PER TURN
// BOUNDARY — each queued message is injected as a user turn before the next LLM
// call, and a turn that would otherwise end (no tool calls) continues if the
// queue is non-empty. This mirrors Claude Code's "type while it works" queueing.
import type { ContentBlockParam } from './types/index.js'
import { uuid } from './util/ids.js'

export type QueuedContent = string | ContentBlockParam[]

export interface QueuedMessage {
  /** Stable id for this queued item — use it to `remove()` a single message. */
  id: string
  content: QueuedContent
  /** Epoch ms when enqueued. */
  at: number
}

export class MessageQueue {
  private items: QueuedMessage[] = []
  private listeners = new Set<(size: number) => void>()

  /**
   * Enqueue a user message to be delivered at the next turn boundary.
   * Returns the item's stable `id` (pass it to `remove()` to cancel just this one).
   */
  push(content: QueuedContent): string {
    const id = uuid()
    this.items.push({ id, content, at: Date.now() })
    this.emit()
    return id
  }

  /** Remove and return the oldest queued message (FIFO), or undefined if empty. */
  shift(): QueuedMessage | undefined {
    const m = this.items.shift()
    if (m) this.emit()
    return m
  }

  /**
   * Remove a single pending message by its `id` (e.g. a per-pill ✕ in the UI).
   * Returns true if an item was removed. No-op if the id isn't pending — already
   * drained (shifted) items can't be cancelled.
   */
  remove(id: string): boolean {
    const i = this.items.findIndex((m) => m.id === id)
    if (i < 0) return false
    this.items.splice(i, 1)
    this.emit()
    return true
  }

  peek(): QueuedMessage | undefined {
    return this.items[0]
  }

  get size(): number {
    return this.items.length
  }

  /** Snapshot of pending messages (does not drain). */
  list(): readonly QueuedMessage[] {
    return this.items.slice()
  }

  clear(): void {
    if (!this.items.length) return
    this.items = []
    this.emit()
  }

  /** Subscribe to size changes (push/shift/clear). Returns an unsubscribe fn. */
  onChange(fn: (size: number) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.items.length)
  }
}
