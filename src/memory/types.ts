// Types for the persistent memory system (ports Claude Code's CLAUDE.md /
// MEMORY.md memory model: user/feedback/project/reference entries that load
// into the system prompt across sessions).

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference'

export type MemoryEntry = {
  /** Stable, unique slug (used as the primary key). */
  name: string
  type: MemoryType
  /** One-line summary used for recall/relevance. */
  description: string
  /** The full memory content. */
  body: string
  createdAt?: number
  updatedAt?: number
}

export type MemoryStoreOptions = {
  dbName?: string
}
