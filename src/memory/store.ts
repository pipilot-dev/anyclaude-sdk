// MemoryStore — durable, queryable memory backed by IndexedDB via Dexie.
// Loads persistent memories into the system prompt across sessions.
//
// `dexie` is an OPTIONAL peer dependency — imported dynamically so this module
// loads even when Dexie isn't installed (the error surfaces only on first use).

import type { MemoryEntry, MemoryStoreOptions, MemoryType } from './types.js'
import { renderMemories } from './render.js'

type Table<T> = {
  get(key: string): Promise<T | undefined>
  put(row: T): Promise<unknown>
  delete(key: string): Promise<unknown>
  toArray(): Promise<T[]>
  clear(): Promise<unknown>
}
type DexieDb = {
  version(v: number): { stores(schema: Record<string, string>): unknown }
  memories: Table<MemoryEntry>
}

export class MemoryStore {
  private readonly dbName: string
  private db: DexieDb | null = null
  private opening: Promise<DexieDb> | null = null

  constructor(options: MemoryStoreOptions = {}) {
    this.dbName = options.dbName ?? 'bcs-memory'
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
        memories: 'name, type, updatedAt',
      })
      this.db = db
      return db
    })()
    return this.opening
  }

  /** Upsert a memory entry by name. */
  async save(entry: MemoryEntry): Promise<void> {
    const db = await this.open()
    const now = Date.now()
    const existing = await db.memories.get(entry.name)
    await db.memories.put({
      ...entry,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    })
  }

  /** Get a memory by name, or null. */
  async get(name: string): Promise<MemoryEntry | null> {
    try {
      const db = await this.open()
      return (await db.memories.get(name)) ?? null
    } catch {
      return null
    }
  }

  /** List memories (optionally filtered by type), newest updatedAt first. */
  async list(type?: MemoryType): Promise<MemoryEntry[]> {
    try {
      const db = await this.open()
      const rows = await db.memories.toArray()
      return rows
        .filter((r) => !type || r.type === type)
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    } catch {
      return []
    }
  }

  /** Delete a memory by name. */
  async remove(name: string): Promise<void> {
    const db = await this.open()
    await db.memories.delete(name)
  }

  /** Wipe all memories. */
  async clear(): Promise<void> {
    const db = await this.open()
    await db.memories.clear()
  }

  /** Render all memories into a system-prompt section ('' if none). */
  async render(): Promise<string> {
    return renderMemories(await this.list())
  }
}
