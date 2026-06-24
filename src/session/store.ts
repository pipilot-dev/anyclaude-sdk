// SessionStore — durable session persistence + resume, backed by IndexedDB via
// Dexie. Stores per-session metadata and the full LLM transcript (ChatMsg[]),
// enabling listSessions/resume/fork/rename across page reloads.
//
// `dexie` is an OPTIONAL peer dependency — imported dynamically so this module
// loads even when Dexie isn't installed (the error surfaces only on first use).

import type { ChatMsg } from '../types/index.js'
import type { SessionMeta, SessionStoreOptions, StoredSession, SessionStoreLike } from './types.js'

// Minimal structural view of the Dexie surface we use (db typed loosely so we
// don't require @types for an optional dependency).
interface MetaRow {
  sessionId: string
  title?: string
  createdAt: number
  updatedAt: number
  model?: string
  messageCount: number
}
interface TranscriptRow {
  sessionId: string
  transcript: ChatMsg[]
}
type Table<T> = {
  get(key: string): Promise<T | undefined>
  put(row: T): Promise<unknown>
  delete(key: string): Promise<unknown>
  toArray(): Promise<T[]>
  clear(): Promise<unknown>
}
type DexieDb = {
  version(v: number): { stores(schema: Record<string, string>): unknown }
  sessions: Table<MetaRow>
  transcripts: Table<TranscriptRow>
}

// The built-in IndexedDB (Dexie) session store. `implements SessionStoreLike`
// guarantees it stays compatible with the pluggable interface the agent expects.
export class SessionStore implements SessionStoreLike {
  private readonly dbName: string
  private db: DexieDb | null = null
  private opening: Promise<DexieDb> | null = null

  constructor(options: SessionStoreOptions = {}) {
    this.dbName = options.dbName ?? 'bcs-sessions'
  }

  private async open(): Promise<DexieDb> {
    if (this.db) return this.db
    if (this.opening) return this.opening
    this.opening = (async () => {
      // @ts-ignore optional peer dependency, resolved at runtime
      const mod = await import('dexie')
      const Dexie = (mod as { default?: unknown }).default ?? mod
      const db = new (Dexie as new (name: string) => DexieDb)(this.dbName)
      db.version(1).stores({
        sessions: 'sessionId, updatedAt',
        transcripts: 'sessionId',
      })
      this.db = db
      return db
    })()
    return this.opening
  }

  /** Upsert a session's transcript + metadata. */
  async save(
    sessionId: string,
    transcript: ChatMsg[],
    meta: { title?: string; model?: string } = {}
  ): Promise<void> {
    const db = await this.open()
    const now = Date.now()
    const existing = await db.sessions.get(sessionId)
    const row: MetaRow = {
      sessionId,
      title: meta.title ?? existing?.title,
      model: meta.model ?? existing?.model,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      messageCount: transcript.length,
    }
    await db.sessions.put(row)
    await db.transcripts.put({ sessionId, transcript })
  }

  /** Load a session's transcript, or null if not found. */
  async load(sessionId: string): Promise<ChatMsg[] | null> {
    try {
      const db = await this.open()
      const row = await db.transcripts.get(sessionId)
      return row?.transcript ?? null
    } catch {
      return null
    }
  }

  /** Load full session (metadata + transcript), or null if not found. */
  async get(sessionId: string): Promise<StoredSession | null> {
    try {
      const db = await this.open()
      const meta = await db.sessions.get(sessionId)
      if (!meta) return null
      const t = await db.transcripts.get(sessionId)
      return { ...meta, transcript: t?.transcript ?? [] }
    } catch {
      return null
    }
  }

  /** List all sessions (metadata only), newest first. */
  async list(): Promise<SessionMeta[]> {
    try {
      const db = await this.open()
      const rows = await db.sessions.toArray()
      return rows.sort((a, b) => b.updatedAt - a.updatedAt)
    } catch {
      return []
    }
  }

  /** Set a session's title. */
  async rename(sessionId: string, title: string): Promise<void> {
    const db = await this.open()
    const meta = await db.sessions.get(sessionId)
    if (!meta) return
    await db.sessions.put({ ...meta, title, updatedAt: Date.now() })
  }

  /** Copy a session's transcript + metadata to a new id. Returns false if source missing. */
  async fork(sessionId: string, newSessionId: string): Promise<boolean> {
    const db = await this.open()
    const meta = await db.sessions.get(sessionId)
    const t = await db.transcripts.get(sessionId)
    if (!meta || !t) return false
    const now = Date.now()
    await db.sessions.put({
      ...meta,
      sessionId: newSessionId,
      title: (meta.title ?? sessionId) + ' (fork)',
      createdAt: now,
      updatedAt: now,
    })
    await db.transcripts.put({ sessionId: newSessionId, transcript: t.transcript })
    return true
  }

  /** Delete a session and its transcript. */
  async remove(sessionId: string): Promise<void> {
    const db = await this.open()
    await db.sessions.delete(sessionId)
    await db.transcripts.delete(sessionId)
  }

  /** Wipe all sessions. */
  async clear(): Promise<void> {
    const db = await this.open()
    await db.sessions.clear()
    await db.transcripts.clear()
  }
}
