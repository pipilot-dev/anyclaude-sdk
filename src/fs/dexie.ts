// DexieFileSystem — a durable, full Linux-style filesystem backed by IndexedDB
// via Dexie. Implements the SDK's FileSystem interface plus power-user methods
// (stat/chmod/symlink/rename/exists/clear).
//
// Model: an inode-per-path table keyed by the normalized absolute path, with a
// `parent` index for O(children) readdir. Persistent across reloads, queryable,
// available in every browser that has IndexedDB.
//
// `dexie` is an OPTIONAL peer dependency — imported dynamically so this module
// loads even when Dexie isn't installed (the error surfaces only on first use).

import type { FileSystem } from '../types/index.js'
import { ancestors, basename, dirname, resolvePath } from '../util/paths.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** A stored filesystem node (file or directory). */
export interface FsNode {
  /** Normalized absolute path (primary key). */
  path: string
  /** Parent directory path (indexed for readdir). '' for the root. */
  parent: string
  /** Final path segment. */
  name: string
  kind: 'file' | 'dir'
  size: number
  /** Last-modified time, epoch ms. */
  mtime: number
  /** POSIX-style mode bits. */
  mode: number
  /** File contents (files only). */
  data?: Uint8Array
  /** Symlink target (symlinks only). */
  symlink?: string
}

export interface DexieFileSystemOptions {
  cwd?: string
  /** Wipe all nodes on first open (fresh filesystem). */
  resetOnInit?: boolean
  /** Use an existing Dexie instance instead of opening one by name — lets the
   *  filesystem share a database your app already owns. It must declare a
   *  `nodes` table keyed by `path` (or be a fresh Dexie this FS can version). */
  db?: unknown
}

const DEFAULT_FILE_MODE = 0o644
const DEFAULT_DIR_MODE = 0o755

// Minimal structural view of the Dexie surface we use (db typed loosely so we
// don't require @types for an optional dependency).
type DexieTable = {
  get(key: string): Promise<FsNode | undefined>
  put(node: FsNode): Promise<unknown>
  delete(key: string): Promise<unknown>
  where(index: string): {
    equals(v: string): { toArray(): Promise<FsNode[]>; primaryKeys(): Promise<string[]> }
    startsWith(v: string): { toArray(): Promise<FsNode[]>; primaryKeys(): Promise<string[]> }
  }
  clear(): Promise<unknown>
  bulkPut(nodes: FsNode[]): Promise<unknown>
}
type DexieDb = {
  version(v: number): { stores(schema: Record<string, string>): unknown }
  nodes: DexieTable
}

export class DexieFileSystem implements FileSystem {
  readonly cwd: string
  private readonly dbName: string
  private readonly resetOnInit: boolean
  private readonly injectedDb: DexieDb | null
  private db: DexieDb | null = null
  private opening: Promise<DexieDb> | null = null

  constructor(dbName = 'bcs-fs', options: DexieFileSystemOptions = {}) {
    this.dbName = dbName
    this.cwd = options.cwd ?? '/'
    this.resetOnInit = options.resetOnInit ?? false
    this.injectedDb = (options.db as DexieDb | undefined) ?? null
  }

  // ---- lifecycle ----

  private async open(): Promise<DexieDb> {
    if (this.db) return this.db
    if (this.opening) return this.opening
    this.opening = (async () => {
      let db: DexieDb
      if (this.injectedDb) {
        // Use the caller's Dexie instance. Declare our schema if it isn't open
        // yet; an already-open db is assumed to carry a compatible `nodes` table.
        db = this.injectedDb
        if (!(db as { isOpen?: () => boolean }).isOpen?.()) {
          db.version(1).stores({ nodes: 'path, parent' })
        }
      } else {
        // @ts-ignore optional peer dependency, resolved at runtime
        const mod = await import('dexie')
        const Dexie = (mod as { default?: unknown }).default ?? mod
        db = new (Dexie as new (name: string) => DexieDb)(this.dbName)
        db.version(1).stores({
          // primary key `path`, secondary index `parent`
          nodes: 'path, parent',
        })
      }
      this.db = db
      if (this.resetOnInit) await db.nodes.clear()
      // Ensure the root directory exists.
      const root = await db.nodes.get('/')
      if (!root) {
        await db.nodes.put({
          path: '/',
          parent: '',
          name: '',
          kind: 'dir',
          size: 0,
          mtime: Date.now(),
          mode: DEFAULT_DIR_MODE,
        })
      }
      return db
    })()
    return this.opening
  }

  private resolve(p: string): string {
    return resolvePath(this.cwd, p)
  }

  /** Create every ancestor directory of `path` (and optionally `path` itself). */
  private async ensureDirs(db: DexieDb, path: string, includeSelf: boolean): Promise<void> {
    const dirs = ancestors(path)
    if (includeSelf) dirs.push(path)
    for (const dir of dirs) {
      if (dir === '/' || dir === '') continue
      const existing = await db.nodes.get(dir)
      if (existing) {
        if (existing.kind !== 'dir') {
          throw new Error(`ENOTDIR: '${dir}' exists and is not a directory`)
        }
        continue
      }
      await db.nodes.put({
        path: dir,
        parent: dirname(dir),
        name: basename(dir),
        kind: 'dir',
        size: 0,
        mtime: Date.now(),
        mode: DEFAULT_DIR_MODE,
      })
    }
  }

  // ---- FileSystem interface ----

  async readFile(path: string): Promise<string | null> {
    const bytes = await this.readBinary(path)
    return bytes ? decoder.decode(bytes) : null
  }

  async readBinary(path: string): Promise<Uint8Array | null> {
    try {
      const db = await this.open()
      const node = await db.nodes.get(this.resolve(path))
      if (!node || node.kind !== 'file') return null
      return node.data ?? new Uint8Array(0)
    } catch {
      return null
    }
  }

  async writeFile(path: string, contents: string): Promise<void> {
    await this.writeBinary(path, encoder.encode(contents))
  }

  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    const db = await this.open()
    const abs = this.resolve(path)
    await this.ensureDirs(db, abs, false)
    const prev = await db.nodes.get(abs)
    await db.nodes.put({
      path: abs,
      parent: dirname(abs),
      name: basename(abs),
      kind: 'file',
      size: data.byteLength,
      mtime: Date.now(),
      mode: prev?.mode ?? DEFAULT_FILE_MODE,
      data,
    })
  }

  async deleteFile(path: string): Promise<void> {
    const db = await this.open()
    const abs = this.resolve(path)
    if (abs === '/') {
      await db.nodes.clear()
      await this.open() // recreate root
      return
    }
    const node = await db.nodes.get(abs)
    await db.nodes.delete(abs)
    if (node?.kind === 'dir') {
      // rm -rf: remove all descendants (path prefix).
      const descendants = await db.nodes.where('path').startsWith(abs + '/').primaryKeys()
      for (const key of descendants) await db.nodes.delete(key)
    }
  }

  async readdir(path: string): Promise<Array<{ name: string; isDir: boolean }> | null> {
    try {
      const db = await this.open()
      const abs = this.resolve(path)
      const node = await db.nodes.get(abs)
      if (!node || node.kind !== 'dir') return null
      const children = await db.nodes.where('parent').equals(abs).toArray()
      return children.map((c) => ({ name: c.name, isDir: c.kind === 'dir' }))
    } catch {
      return null
    }
  }

  async mkdir(path: string): Promise<void> {
    const db = await this.open()
    await this.ensureDirs(db, this.resolve(path), true)
  }

  // ---- power-user extensions ----

  /** Return node metadata (without the data blob), or null if missing. */
  async stat(path: string): Promise<Omit<FsNode, 'data'> | null> {
    try {
      const db = await this.open()
      const node = await db.nodes.get(this.resolve(path))
      if (!node) return null
      const { data: _data, ...meta } = node
      return meta
    } catch {
      return null
    }
  }

  async exists(path: string): Promise<boolean> {
    const db = await this.open()
    return (await db.nodes.get(this.resolve(path))) != null
  }

  async chmod(path: string, mode: number): Promise<void> {
    const db = await this.open()
    const abs = this.resolve(path)
    const node = await db.nodes.get(abs)
    if (!node) throw new Error(`ENOENT: no such file '${abs}'`)
    node.mode = mode
    node.mtime = Date.now()
    await db.nodes.put(node)
  }

  /** Create a symlink node at `linkPath` pointing at `target`. */
  async symlink(target: string, linkPath: string): Promise<void> {
    const db = await this.open()
    const abs = this.resolve(linkPath)
    await this.ensureDirs(db, abs, false)
    await db.nodes.put({
      path: abs,
      parent: dirname(abs),
      name: basename(abs),
      kind: 'file',
      size: target.length,
      mtime: Date.now(),
      mode: 0o777,
      symlink: target,
    })
  }

  /** Move/rename a node (and its descendants, for directories). */
  async rename(from: string, to: string): Promise<void> {
    const db = await this.open()
    const src = this.resolve(from)
    const dst = this.resolve(to)
    const node = await db.nodes.get(src)
    if (!node) throw new Error(`ENOENT: no such file '${src}'`)
    await this.ensureDirs(db, dst, false)

    const move = (n: FsNode, newPath: string): FsNode => ({
      ...n,
      path: newPath,
      parent: dirname(newPath),
      name: basename(newPath),
      mtime: Date.now(),
    })

    if (node.kind === 'dir') {
      const descendants = await db.nodes.where('path').startsWith(src + '/').toArray()
      const moved: FsNode[] = [move(node, dst)]
      for (const d of descendants) moved.push(move(d, dst + d.path.slice(src.length)))
      await db.nodes.bulkPut(moved)
      await db.nodes.delete(src)
      for (const d of descendants) await db.nodes.delete(d.path)
    } else {
      await db.nodes.put(move(node, dst))
      await db.nodes.delete(src)
    }
  }

  /** Wipe the entire filesystem (then recreate the root). */
  async clear(): Promise<void> {
    const db = await this.open()
    await db.nodes.clear()
    this.db = null
    this.opening = null
    await this.open()
  }
}
