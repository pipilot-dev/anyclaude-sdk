// KVSessionStore — back sessions with any key/value store: Vercel KV,
// Cloudflare KV, Upstash Redis (@upstash/redis), or any `{get,set}` client.
//
//   import { createClient } from '@vercel/kv'        // or @upstash/redis
//   const kv = createClient({ url, token })
//   const store = new KVSessionStore(kv)
//   query({ sessionStore: store, sessionId, resume: true, continueRun: true, … })
//
// Each session is stored as one JSON value under `${prefix}${sessionId}`
// (default prefix `bcs:session:`). `list`/`remove` need a `keys`-capable client.
import type { ChatMsg } from '../../types/index.js'
import type { SessionMeta, SessionStoreLike, StoredSession } from '../types.js'

/** Structural view of a KV client (Vercel KV / Upstash Redis / Cloudflare KV). */
export interface KVClientLike {
  get(key: string): Promise<unknown>
  set(key: string, value: string): Promise<unknown>
  del?(key: string): Promise<unknown>
  /** Glob-style key listing (e.g. Upstash/ioredis `keys('bcs:session:*')`). */
  keys?(pattern: string): Promise<string[]>
}

function parse(raw: unknown): StoredSession | null {
  if (raw == null) return null
  const obj = typeof raw === 'string' ? (JSON.parse(raw) as StoredSession) : (raw as StoredSession)
  return obj && Array.isArray(obj.transcript) ? obj : null
}

export class KVSessionStore implements SessionStoreLike {
  constructor(
    private readonly kv: KVClientLike,
    private readonly prefix = 'bcs:session:'
  ) {}

  private key(id: string): string {
    return this.prefix + id
  }

  async get(sessionId: string): Promise<StoredSession | null> {
    return parse(await this.kv.get(this.key(sessionId)))
  }

  async load(sessionId: string): Promise<ChatMsg[] | null> {
    const s = await this.get(sessionId)
    return s ? s.transcript : null
  }

  async save(
    sessionId: string,
    transcript: ChatMsg[],
    meta: { title?: string; model?: string } = {}
  ): Promise<void> {
    const now = Date.now()
    const existing = await this.get(sessionId)
    const row: StoredSession = {
      sessionId,
      title: meta.title ?? existing?.title,
      model: meta.model ?? existing?.model,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      messageCount: transcript.length,
      transcript,
    }
    await this.kv.set(this.key(sessionId), JSON.stringify(row))
  }

  async list(): Promise<SessionMeta[]> {
    if (!this.kv.keys) return []
    const keys = await this.kv.keys(this.prefix + '*')
    const rows = await Promise.all(keys.map((k) => this.kv.get(k).then(parse)))
    return rows
      .filter((s): s is StoredSession => !!s)
      .map(({ transcript: _t, ...meta }) => meta)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async rename(sessionId: string, title: string): Promise<void> {
    const s = await this.get(sessionId)
    if (!s) return
    await this.kv.set(this.key(sessionId), JSON.stringify({ ...s, title, updatedAt: Date.now() }))
  }

  async remove(sessionId: string): Promise<void> {
    await this.kv.del?.(this.key(sessionId))
  }
}
