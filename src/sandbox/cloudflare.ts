// Cloudflare Sandbox adapter.
//
// Wrap a `@cloudflare/sandbox` instance (Cloudflare Containers):
//
//   import { getSandbox } from '@cloudflare/sandbox'
//   const sbx = getSandbox(env.Sandbox, 'my-session')
//   const workspace = new CloudflareSandbox(sbx)
//
// Methods used:
//   sbx.exec(command) -> { stdout, stderr, exitCode }
//   sbx.readFile(path) -> string | { content: string }
//   sbx.writeFile(path, content)
//   sbx.mkdir(path, { recursive })
//   sbx.deleteFile(path)
//   sbx.listFiles(path)  (optional; falls back to `ls -1Ap` via exec)

import type { CommandExecutor, FileSystem } from '../types/index.js'
import type { Sandbox } from './types.js'
import { resolvePath } from '../util/paths.js'
import { base64ToBytes, bytesToBase64, shellQuote } from './util.js'

interface CfExecResult {
  stdout?: string
  stderr?: string
  exitCode?: number
}

interface CfFileEntry {
  name: string
  isDir?: boolean
  type?: string
}

export interface CloudflareClientLike {
  exec(command: string, opts?: { cwd?: string }): Promise<CfExecResult>
  readFile?(path: string): Promise<string | { content?: string }>
  writeFile?(path: string, content: string): Promise<unknown>
  mkdir?(path: string, opts?: { recursive?: boolean }): Promise<unknown>
  deleteFile?(path: string): Promise<unknown>
  listFiles?(path: string): Promise<CfFileEntry[]>
}

const encoder = new TextEncoder()

export class CloudflareSandbox implements Sandbox, FileSystem, CommandExecutor {
  readonly cwd: string
  constructor(private readonly client: CloudflareClientLike, cwd = '/workspace') {
    this.cwd = cwd
  }

  private r(p: string): string {
    return resolvePath(this.cwd, p)
  }

  async readFile(path: string): Promise<string | null> {
    const abs = this.r(path)
    if (this.client.readFile) {
      try {
        const res = await this.client.readFile(abs)
        if (typeof res === 'string') return res
        return res?.content ?? null
      } catch {
        return null
      }
    }
    const res = await this.client.exec(`cat ${shellQuote(abs)}`)
    return (res.exitCode ?? 0) === 0 ? (res.stdout ?? '') : null
  }

  async readBinary(path: string): Promise<Uint8Array | null> {
    // No portable native binary read; round-trip through base64 over exec.
    const abs = this.r(path)
    const res = await this.client.exec(`base64 ${shellQuote(abs)} | tr -d '\\n'`)
    if ((res.exitCode ?? 0) !== 0) {
      // Fall back to a text read if base64 is unavailable.
      const text = await this.readFile(path)
      return text === null ? null : encoder.encode(text)
    }
    try {
      return base64ToBytes((res.stdout ?? '').trim())
    } catch {
      return null
    }
  }

  async writeFile(path: string, contents: string): Promise<void> {
    const abs = this.r(path)
    if (this.client.writeFile) {
      await this.client.writeFile(abs, contents)
      return
    }
    await this.client.exec(
      `mkdir -p ${shellQuote(dir(abs))} && cat > ${shellQuote(abs)} <<'BCS_EOF'\n${contents}\nBCS_EOF`
    )
  }

  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    const abs = this.r(path)
    // base64-decode through the shell so arbitrary bytes survive.
    const b64 = bytesToBase64(data)
    const res = await this.client.exec(
      `mkdir -p ${shellQuote(dir(abs))} && printf %s ${shellQuote(b64)} | base64 -d > ${shellQuote(abs)}`
    )
    if ((res.exitCode ?? 0) !== 0) {
      throw new Error(`writeBinary failed: ${res.stderr ?? res.stdout ?? ''}`)
    }
  }

  async deleteFile(path: string): Promise<void> {
    const abs = this.r(path)
    if (this.client.deleteFile) {
      await this.client.deleteFile(abs)
      return
    }
    await this.client.exec(`rm -rf ${shellQuote(abs)}`)
  }

  async readdir(path: string): Promise<Array<{ name: string; isDir: boolean }> | null> {
    const abs = this.r(path)
    if (this.client.listFiles) {
      try {
        const entries = await this.client.listFiles(abs)
        return entries.map((e) => ({ name: e.name, isDir: e.isDir ?? e.type === 'dir' }))
      } catch {
        return null
      }
    }
    const res = await this.client.exec(`ls -1Ap ${shellQuote(abs)}`)
    if ((res.exitCode ?? 0) !== 0) return null
    return (res.stdout ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((name) =>
        name.endsWith('/') ? { name: name.slice(0, -1), isDir: true } : { name, isDir: false }
      )
  }

  async mkdir(path: string): Promise<void> {
    const abs = this.r(path)
    if (this.client.mkdir) {
      await this.client.mkdir(abs, { recursive: true })
      return
    }
    await this.client.exec(`mkdir -p ${shellQuote(abs)}`)
  }

  async exec(
    command: string,
    _timeoutMs?: number,
    _env?: Record<string, string>
  ): Promise<{ output: string; exitCode: number }> {
    const res = await this.client.exec(command, { cwd: this.cwd })
    const out = (res.stdout ?? '') + (res.stderr ? '\n' + res.stderr : '')
    return { output: out.trimEnd(), exitCode: res.exitCode ?? 0 }
  }
}

function dir(p: string): string {
  const i = p.lastIndexOf('/')
  return i <= 0 ? '/' : p.slice(0, i)
}

export function createCloudflareSandbox(
  client: CloudflareClientLike,
  cwd?: string
): CloudflareSandbox {
  return new CloudflareSandbox(client, cwd)
}
