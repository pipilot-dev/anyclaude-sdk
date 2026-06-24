// Session persistence types.

import type { ChatMsg } from '../types/index.js'

/** Lightweight metadata for a stored session (no transcript). */
export interface SessionMeta {
  sessionId: string
  title?: string
  /** Epoch ms when the session was first saved. */
  createdAt: number
  /** Epoch ms of the last save. */
  updatedAt: number
  /** Model id last used in the session. */
  model?: string
  /** Number of transcript messages at last save. */
  messageCount: number
}

/** A full stored session: metadata plus the LLM transcript. */
export type StoredSession = SessionMeta & { transcript: ChatMsg[] }

export interface SessionStoreOptions {
  /** IndexedDB database name. Default: 'bcs-sessions'. */
  dbName?: string
}

/**
 * Minimal pluggable session store — implement this to back persistence with any
 * database (Supabase, Neon/Postgres, Vercel KV, Upstash Redis, files, …). The
 * agent loop only needs `load` + `save`; the rest are for UIs/management.
 */
export interface SessionStoreLike {
  /** Return the stored transcript for a session, or null if none. */
  load(sessionId: string): Promise<ChatMsg[] | null>
  /** Persist the transcript (called after each turn + on a paused boundary). */
  save(sessionId: string, transcript: ChatMsg[], meta?: { title?: string; model?: string }): Promise<void>
  /** Optional: list sessions (metadata only). */
  list?(): Promise<SessionMeta[]>
  /** Optional: full stored session. */
  get?(sessionId: string): Promise<StoredSession | null>
  /** Optional: rename a session. */
  rename?(sessionId: string, title: string): Promise<void>
  /** Optional: delete a session. */
  remove?(sessionId: string): Promise<void>
}
