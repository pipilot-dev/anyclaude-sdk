// A Mailbox that gossips across execution contexts (Web Workers, browser tabs,
// Node worker_threads) over a BroadcastChannel. Drop-in for the in-memory
// Mailbox: the existing `team` tools (send_message / dispatch_tasks) work
// unchanged, but messages now propagate to every agent on the same channel.
//
// Design: each instance keeps its own eventually-consistent replica of the
// message stream. `send()` appends locally AND posts on the channel; every
// other instance ingests the inbound message into its replica (de-duped by a
// globally-unique id). `inbox()`/`all()`/`markRead()` read/mutate the local
// replica synchronously — read state is per-instance (each agent tracks what
// *it* has seen), which is exactly the inbox semantics we want.
//
// Browser-safe: BroadcastChannel is a Web API (also a Node >=15 global inside
// worker_threads). For older runtimes or cross-tab durability, inject the
// `broadcast-channel` npm package's channel via the `channel` option.

import { Mailbox } from './mailbox.js'
import type { AgentMessage } from './mailbox.js'

/** Minimal structural type for a BroadcastChannel-like transport, so callers
 *  can inject the `broadcast-channel` polyfill or any compatible object. */
export interface ChannelLike {
  postMessage(data: unknown): void
  /** Native BroadcastChannel uses an `onmessage` setter with `{data}` events. */
  onmessage?: ((ev: { data: unknown }) => void) | null
  /** `broadcast-channel` polyfill uses addEventListener('message', fn). */
  addEventListener?: (type: 'message', fn: (data: unknown) => void) => void
  close?: () => void
}

type Wire = { __ac: 'msg'; origin: string; message: AgentMessage }

function isWire(d: unknown): d is Wire {
  return !!d && typeof d === 'object' && (d as { __ac?: unknown }).__ac === 'msg'
}

export interface BroadcastChannelMailboxOptions {
  /** Channel name (default 'anyclaude-team'). Ignored if `channel` is given. */
  channelName?: string
  /** Inject a ready-made channel (e.g. the `broadcast-channel` package) or a
   *  custom BroadcastChannel factory. When omitted, the global BroadcastChannel
   *  is used. */
  channel?: ChannelLike
  /** Stable origin id for this instance; defaults to a random id. Set it to a
   *  worker/agent name if you want deterministic, debuggable message ids. */
  origin?: string
}

function randomId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  if (g.crypto?.randomUUID) return g.crypto.randomUUID().slice(0, 8)
  // Fallback without Math.random reliance: derive from high-res-ish counters.
  return 'o' + (Date.now().toString(36) + (originSeed++).toString(36))
}
let originSeed = 0

export class BroadcastChannelMailbox extends Mailbox {
  private readonly channel: ChannelLike
  private readonly origin: string
  private closed = false

  constructor(opts: BroadcastChannelMailboxOptions = {}) {
    super()
    this.origin = opts.origin ?? randomId()

    let ch = opts.channel
    if (!ch) {
      const BC = (globalThis as { BroadcastChannel?: new (name: string) => ChannelLike })
        .BroadcastChannel
      if (!BC) {
        throw new Error(
          'BroadcastChannel is not available in this runtime. Pass `channel` ' +
            '(e.g. from the `broadcast-channel` npm package) to BroadcastChannelMailbox.'
        )
      }
      ch = new BC(opts.channelName ?? 'anyclaude-team')
    }
    this.channel = ch

    // Normalize both delivery shapes: native BroadcastChannel hands the listener
    // a MessageEvent ({data}); the `broadcast-channel` polyfill hands it the raw
    // payload. Accept either, then de-dupe via the protected ingest().
    const handle = (arg: unknown) => {
      if (this.closed) return
      let data: unknown = arg
      if (!isWire(arg) && arg && typeof arg === 'object' && 'data' in arg) {
        data = (arg as { data: unknown }).data
      }
      if (isWire(data) && data.origin !== this.origin) this.ingest(data.message)
    }
    // Single registration: addEventListener when available (native + polyfill
    // both support it), otherwise the onmessage setter.
    if (typeof this.channel.addEventListener === 'function') {
      this.channel.addEventListener('message', handle)
    } else {
      this.channel.onmessage = (ev) => handle(ev)
    }
  }

  /** Send a message: append to the local replica and broadcast to peers. */
  override send(from: string, to: string, text: string): string {
    // Globally-unique id: origin-scoped so two workers never collide.
    const id = `msg_${this.origin}_${++this.counter}`
    const m: AgentMessage = { id, from, to, text, ts: Date.now(), read: false }
    this.ingest(m)
    if (!this.closed) {
      const wire: Wire = { __ac: 'msg', origin: this.origin, message: m }
      this.channel.postMessage(wire)
    }
    return id
  }

  /** Stop listening and release the channel. Safe to call more than once. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.channel.close?.()
  }
}
