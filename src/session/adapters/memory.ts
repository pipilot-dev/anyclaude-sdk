// In-memory session store — implements SessionStoreLike with a plain Map.
// Handy for tests, or a single long-lived server process. Not durable across
// restarts; for serverless use KV/Redis/Postgres/Supabase, for the browser use
// the IndexedDB-backed SessionStore.
import type { ChatMsg } from '../../types/index.js'
import type { SessionMeta, SessionStoreLike, StoredSession } from '../types.js'

export class MemorySessionStore implements SessionStoreLike {
  private readonly data = new Map<string, StoredSession>()

  async load(sessionId: string): Promise<ChatMsg[] | null> {
    return this.data.get(sessionId)?.transcript ?? null
  }

  async save(
    sessionId: string,
    transcript: ChatMsg[],
    meta?: { title?: string; model?: string }
  ): Promise<void> {
    const now = Date.now()
    const prev = this.data.get(sessionId)
    this.data.set(sessionId, {
      sessionId,
      title: meta?.title ?? prev?.title,
      model: meta?.model ?? prev?.model,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      messageCount: transcript.length,
      transcript: transcript.slice(),
    })
  }

  async get(sessionId: string): Promise<StoredSession | null> {
    return this.data.get(sessionId) ?? null
  }

  async list(): Promise<SessionMeta[]> {
    return [...this.data.values()]
      .map(({ transcript: _t, ...meta }) => meta)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async rename(sessionId: string, title: string): Promise<void> {
    const s = this.data.get(sessionId)
    if (s) s.title = title
  }

  async remove(sessionId: string): Promise<void> {
    this.data.delete(sessionId)
  }
}
