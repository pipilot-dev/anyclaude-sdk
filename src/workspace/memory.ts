import type { CommandExecutor, FileSystem } from '../types/index.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * A pure in-memory FileSystem. Useful for tests and environments without a
 * WebContainer. Does not implement CommandExecutor — pair it with a custom
 * executor or `NoopCommandExecutor` if bash is not needed.
 */
export class MemoryFileSystem implements FileSystem {
  private files = new Map<string, Uint8Array>()
  private dirs = new Set<string>(['/'])

  private norm(path: string): string {
    const isAbs = path.startsWith('/')
    const out: string[] = []
    for (const seg of path.split('/')) {
      if (seg === '' || seg === '.') continue
      if (seg === '..') out.pop()
      else out.push(seg)
    }
    return (isAbs ? '/' : '') + out.join('/')
  }

  async readFile(path: string): Promise<string | null> {
    const data = this.files.get(this.norm(path))
    return data ? decoder.decode(data) : null
  }

  async readBinary(path: string): Promise<Uint8Array | null> {
    return this.files.get(this.norm(path)) ?? null
  }

  async writeFile(path: string, contents: string): Promise<void> {
    await this.writeBinary(path, encoder.encode(contents))
  }

  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    const p = this.norm(path)
    this.files.set(p, data)
    let dir = p.slice(0, p.lastIndexOf('/')) || '/'
    while (dir && !this.dirs.has(dir)) {
      this.dirs.add(dir)
      dir = dir.slice(0, dir.lastIndexOf('/')) || '/'
    }
  }

  async deleteFile(path: string): Promise<void> {
    const p = this.norm(path)
    this.files.delete(p)
    for (const f of [...this.files.keys()]) {
      if (f.startsWith(p + '/')) this.files.delete(f)
    }
    this.dirs.delete(p)
  }

  async readdir(path: string): Promise<Array<{ name: string; isDir: boolean }> | null> {
    const p = this.norm(path)
    if (!this.dirs.has(p) && p !== '/') {
      // allow listing a dir that only exists implicitly via files
      const hasChildren = [...this.files.keys(), ...this.dirs].some((k) =>
        k.startsWith(p + '/')
      )
      if (!hasChildren) return null
    }
    const prefix = p === '/' ? '/' : p + '/'
    const names = new Map<string, boolean>()
    for (const f of this.files.keys()) {
      if (f.startsWith(prefix)) {
        const rest = f.slice(prefix.length)
        const slash = rest.indexOf('/')
        if (slash === -1) names.set(rest, false)
        else names.set(rest.slice(0, slash), true)
      }
    }
    for (const d of this.dirs) {
      if (d.startsWith(prefix) && d !== p) {
        const rest = d.slice(prefix.length)
        const name = rest.split('/')[0]
        if (name) names.set(name, true)
      }
    }
    return [...names].map(([name, isDir]) => ({ name, isDir }))
  }

  async mkdir(path: string): Promise<void> {
    let dir = this.norm(path)
    while (dir && !this.dirs.has(dir)) {
      this.dirs.add(dir)
      dir = dir.slice(0, dir.lastIndexOf('/')) || '/'
    }
  }
}

/** A CommandExecutor that refuses to run anything — for FS-only workspaces. */
export class NoopCommandExecutor implements CommandExecutor {
  async exec(): Promise<{ output: string; exitCode: number }> {
    return { output: 'bash is not available in this workspace', exitCode: 127 }
  }
}
