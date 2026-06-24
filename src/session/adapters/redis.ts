// RedisSessionStore — back sessions with Redis (ioredis or node-redis), or any
// `{ get, set, del, keys }` client. Each session is one JSON string under
// `${prefix}${sessionId}` (default `bcs:session:`); `list` uses KEYS.
//
//   import Redis from 'ioredis'
//   const store = new RedisSessionStore(new Redis(process.env.REDIS_URL))
//   query({ sessionStore: store, sessionId, resume: true, continueRun: true, … })
//
// Note: KEYS scans the keyspace; for very large deployments prefer a client that
// supports SCAN, or keep an index set. Fine for typical session counts.
import type { ChatMsg } from '../../types/index.js'
import type { SessionMeta, SessionStoreLike, StoredSession } from '../types.js'

/** Structural view of a Redis client (ioredis / node-redis). */
export interface RedisClientLike {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<unknown>
  del(key: string): Promise<unknown>
  keys(pattern: string): Promise<string[]>
}

export class RedisSessionStore implements SessionStoreLike {
  constructor(
    private readonly redis: RedisClientLike,
    private readonly prefix = 'bcs:session:'
  ) {}

  private key(id: string): string {
    return this.prefix + id
  }

  async get(sessionId: string): Promise<StoredSession | null> {
    const raw = await this.redis.get(this.key(sessionId))
    if (!raw) return null
    const obj = JSON.parse(raw) as StoredSession
    return Array.isArray(obj.transcript) ? obj : null
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
    await this.redis.set(this.key(sessionId), JSON.stringify(row))
  }

  async list(): Promise<SessionMeta[]> {
    const keys = await this.redis.keys(this.prefix + '*')
    const raws = await Promise.all(keys.map((k) => this.redis.get(k)))
    return raws
      .filter((r): r is string => !!r)
      .map((r) => JSON.parse(r) as StoredSession)
      .map(({ transcript: _t, ...meta }) => meta)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async rename(sessionId: string, title: string): Promise<void> {
    const s = await this.get(sessionId)
    if (!s) return
    await this.redis.set(this.key(sessionId), JSON.stringify({ ...s, title, updatedAt: Date.now() }))
  }

  async remove(sessionId: string): Promise<void> {
    await this.redis.del(this.key(sessionId))
  }
}
