// OpfsFileSystem — backed by the Origin Private File System (OPFS). Gives a
// true hierarchical, persistent filesystem with native binary storage; best for
// large files. Implements the SDK's FileSystem interface.
//
// OPFS has no metadata (mode/mtime) or symlinks — use DexieFileSystem when you
// need those. Reads return null on NotFound rather than throwing.

import type { FileSystem } from '../types/index.js'
import { resolvePath, segments } from '../util/paths.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// Structural typing of the OPFS handle surface (avoids relying on lib.dom
// FileSystem*Handle types being present in every TS config).
interface DirHandle {
  kind: 'directory'
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandle>
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandle>
  removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void>
  entries(): AsyncIterableIterator<[string, DirHandle | FileHandle]>
}
interface FileHandle {
  kind: 'file'
  getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>
  createWritable(): Promise<{ write(data: Uint8Array | string): Promise<void>; close(): Promise<void> }>
}

export interface OpfsFileSystemOptions {
  cwd?: string
}

export class OpfsFileSystem implements FileSystem {
  readonly cwd: string

  constructor(options: OpfsFileSystemOptions = {}) {
    this.cwd = options.cwd ?? '/'
  }

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory
  }

  private async root(): Promise<DirHandle> {
    const nav = navigator as unknown as {
      storage: { getDirectory(): Promise<DirHandle> }
    }
    return nav.storage.getDirectory()
  }

  /** Walk to the directory handle for `dirSegments`, optionally creating it. */
  private async dirHandle(dirSegments: string[], create: boolean): Promise<DirHandle | null> {
    let handle = await this.root()
    for (const seg of dirSegments) {
      try {
        handle = await handle.getDirectoryHandle(seg, { create })
      } catch {
        return null
      }
    }
    return handle
  }

  private split(path: string): { dir: string[]; name: string | null } {
    const segs = segments(resolvePath(this.cwd, path))
    if (segs.length === 0) return { dir: [], name: null } // root
    return { dir: segs.slice(0, -1), name: segs[segs.length - 1] }
  }

  // ---- FileSystem interface ----

  async readBinary(path: string): Promise<Uint8Array | null> {
    try {
      const { dir, name } = this.split(path)
      if (name == null) return null
      const parent = await this.dirHandle(dir, false)
      if (!parent) return null
      const fh = await parent.getFileHandle(name, { create: false })
      const file = await fh.getFile()
      return new Uint8Array(await file.arrayBuffer())
    } catch {
      return null
    }
  }

  async readFile(path: string): Promise<string | null> {
    const bytes = await this.readBinary(path)
    return bytes ? decoder.decode(bytes) : null
  }

  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    const { dir, name } = this.split(path)
    if (name == null) throw new Error('EISDIR: cannot write to root')
    const parent = await this.dirHandle(dir, true)
    if (!parent) throw new Error(`ENOENT: cannot create '${path}'`)
    const fh = await parent.getFileHandle(name, { create: true })
    const w = await fh.createWritable()
    await w.write(data)
    await w.close()
  }

  async writeFile(path: string, contents: string): Promise<void> {
    await this.writeBinary(path, encoder.encode(contents))
  }

  async deleteFile(path: string): Promise<void> {
    const { dir, name } = this.split(path)
    if (name == null) return
    const parent = await this.dirHandle(dir, false)
    if (!parent) return
    try {
      await parent.removeEntry(name, { recursive: true })
    } catch {
      // already gone
    }
  }

  async readdir(path: string): Promise<Array<{ name: string; isDir: boolean }> | null> {
    try {
      const segs = segments(resolvePath(this.cwd, path))
      const handle = await this.dirHandle(segs, false)
      if (!handle) return null
      const out: Array<{ name: string; isDir: boolean }> = []
      for await (const [entryName, entry] of handle.entries()) {
        out.push({ name: entryName, isDir: entry.kind === 'directory' })
      }
      return out
    } catch {
      return null
    }
  }

  async mkdir(path: string): Promise<void> {
    const segs = segments(resolvePath(this.cwd, path))
    const handle = await this.dirHandle(segs, true)
    if (!handle) throw new Error(`ENOENT: cannot create directory '${path}'`)
  }
}
