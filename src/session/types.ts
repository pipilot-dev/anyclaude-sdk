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
