// E2B sandbox adapter.
//
// Wrap an E2B `Sandbox` (from the `e2b` or `@e2b/code-interpreter` package):
//
//   import { Sandbox } from 'e2b'
//   const sbx = await Sandbox.create()
//   const workspace = new E2BSandbox(sbx)
//
// Methods used (E2B JS SDK):
//   sbx.files.read(path, { format })   // 'text' -> string, 'bytes' -> Uint8Array
//   sbx.files.write(path, data)
//   sbx.files.list(path)               // EntryInfo[] { name, type: 'file'|'dir' }
//   sbx.files.remove(path)
//   sbx.files.makeDir(path)
//   sbx.commands.run(cmd, { timeoutMs, envs, cwd })  // { stdout, stderr, exitCode }

import type { CommandExecutor, FileSystem } from '../types/index.js'
import type { Sandbox } from './types.js'
import { resolvePath } from '../util/paths.js'

interface E2BEntry {
  name: string
  type?: 'file' | 'dir'
  isDir?: boolean
}

interface E2BCommandResult {
  stdout?: string
  stderr?: string
  exitCode?: number
}

export interface E2BClientLike {
  files: {
    read(path: string, opts?: { format?: 'text' | 'bytes' | 'blob' | 'stream' }): Promise<unknown>
    write(path: string, data: string | Uint8Array): Promise<unknown>
    list(path: string): Promise<E2BEntry[]>
    remove(path: string): Promise<unknown>
    makeDir(path: string): Promise<unknown>
  }
  commands: {
    run(
      cmd: string,
      opts?: { timeoutMs?: number; envs?: Record<string, string>; cwd?: string; background?: false }
    ): Promise<E2BCommandResult>
  }
}

const decoder = new TextDecoder()

export class E2BSandbox implements Sandbox, FileSystem, CommandExecutor {
  readonly cwd: string
  constructor(private readonly client: E2BClientLike, cwd = '/home/user') {
    this.cwd = cwd
  }

  private r(p: string): string {
    return resolvePath(this.cwd, p)
  }

  async readFile(path: string): Promise<string | null> {
    try {
      const data = await this.client.files.read(this.r(path), { format: 'text' })
      return typeof data === 'string' ? data : decoder.decode(data as Uint8Array)
    } catch {
      return null
    }
  }

  async readBinary(path: string): Promise<Uint8Array | null> {
    try {
      const data = await this.client.files.read(this.r(path), { format: 'bytes' })
      if (data instanceof Uint8Array) return data
      if (data instanceof ArrayBuffer) return new Uint8Array(data)
      if (typeof data === 'string') return new TextEncoder().encode(data)
      return null
    } catch {
      return null
    }
  }

  async writeFile(path: string, contents: string): Promise<void> {
    await this.client.files.write(this.r(path), contents)
  }

  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    await this.client.files.write(this.r(path), data)
  }

  async deleteFile(path: string): Promise<void> {
    await this.client.files.remove(this.r(path))
  }

  async readdir(path: string): Promise<Array<{ name: string; isDir: boolean }> | null> {
    try {
      const entries = await this.client.files.list(this.r(path))
      return entries.map((e) => ({
        name: e.name,
        isDir: e.isDir ?? e.type === 'dir',
      }))
    } catch {
      return null
    }
  }

  async mkdir(path: string): Promise<void> {
    await this.client.files.makeDir(this.r(path))
  }

  async exec(
    command: string,
    timeoutMs = 120_000,
    env?: Record<string, string>
  ): Promise<{ output: string; exitCode: number }> {
    const res = await this.client.commands.run(command, {
      timeoutMs,
      envs: env,
      cwd: this.cwd,
    })
    const out = (res.stdout ?? '') + (res.stderr ? '\n' + res.stderr : '')
    return { output: out.trimEnd(), exitCode: res.exitCode ?? 0 }
  }
}

/** Convenience factory mirroring `new E2BSandbox(client, cwd)`. */
export function createE2BSandbox(client: E2BClientLike, cwd?: string): E2BSandbox {
  return new E2BSandbox(client, cwd)
}
