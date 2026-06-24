// Vercel Sandbox adapter.
//
// Wrap a `@vercel/sandbox` `Sandbox`:
//
//   import { Sandbox } from '@vercel/sandbox'
//   const sbx = await Sandbox.create({ ... })
//   const workspace = new VercelSandbox(sbx)
//
// Primary method used: sbx.runCommand({ cmd, args, env, cwd }) -> result with
//   `.exitCode` and `.stdout()` / `.stderr()` (string | stream | thunk).
//
// File ops: the adapter prefers native methods when the client exposes them
//   (readFile({path}), writeFiles([{path,content}]), mkdir(path)), and otherwise
//   falls back to POSIX shell commands run via runCommand (cat / base64 / ls /
//   mkdir -p / rm). The shell fallback assumes a Unix image with `base64`.

import type { CommandExecutor, FileSystem } from '../types/index.js'
import type { Sandbox } from './types.js'
import { dirname, resolvePath } from '../util/paths.js'
import {
  base64ToBytes,
  bytesToBase64,
  shellQuote,
  toBytes,
  toText,
  type MaybeAsync,
} from './util.js'

interface VercelCommandResult {
  exitCode?: number
  stdout?: MaybeAsync<string | Uint8Array>
  stderr?: MaybeAsync<string | Uint8Array>
}

export interface VercelClientLike {
  runCommand(opts: {
    cmd: string
    args?: string[]
    env?: Record<string, string>
    cwd?: string
  }): Promise<VercelCommandResult>
  // Optional native file ops (used when present).
  readFile?(opts: { path: string }): Promise<unknown>
  writeFiles?(files: Array<{ path: string; content: Uint8Array | string }>): Promise<unknown>
  mkdir?(path: string): Promise<unknown>
}

export class VercelSandbox implements Sandbox, FileSystem, CommandExecutor {
  readonly cwd: string
  constructor(private readonly client: VercelClientLike, cwd = '/vercel/sandbox') {
    this.cwd = cwd
  }

  private r(p: string): string {
    return resolvePath(this.cwd, p)
  }

  /** Run a shell command string, returning combined output + exit code. */
  private async sh(command: string): Promise<{ output: string; exitCode: number }> {
    const res = await this.client.runCommand({
      cmd: 'sh',
      args: ['-c', command],
      cwd: this.cwd,
    })
    const out = await toText(res.stdout)
    const err = await toText(res.stderr)
    return {
      output: (out + (err ? (out ? '\n' : '') + err : '')).trimEnd(),
      exitCode: res.exitCode ?? 0,
    }
  }

  async readFile(path: string): Promise<string | null> {
    const abs = this.r(path)
    if (this.client.readFile) {
      try {
        return await toText(
          (await this.client.readFile({ path: abs })) as Parameters<typeof toText>[0]
        )
      } catch {
        return null
      }
    }
    const { output, exitCode } = await this.sh(`cat ${shellQuote(abs)}`)
    return exitCode === 0 ? output : null
  }

  async readBinary(path: string): Promise<Uint8Array | null> {
    const abs = this.r(path)
    if (this.client.readFile) {
      try {
        return await toBytes(
          (await this.client.readFile({ path: abs })) as Parameters<typeof toBytes>[0]
        )
      } catch {
        return null
      }
    }
    const { output, exitCode } = await this.sh(`base64 ${shellQuote(abs)} | tr -d '\\n'`)
    if (exitCode !== 0) return null
    try {
      return base64ToBytes(output.trim())
    } catch {
      return null
    }
  }

  async writeFile(path: string, contents: string): Promise<void> {
    await this.writeBinary(path, new TextEncoder().encode(contents))
  }

  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    const abs = this.r(path)
    if (this.client.writeFiles) {
      await this.client.writeFiles([{ path: abs, content: data }])
      return
    }
    // Shell fallback: recreate parent dir and pipe base64 through `base64 -d`.
    const b64 = bytesToBase64(data)
    const dir = dirname(abs)
    const { exitCode, output } = await this.sh(
      `mkdir -p ${shellQuote(dir)} && printf %s ${shellQuote(b64)} | base64 -d > ${shellQuote(abs)}`
    )
    if (exitCode !== 0) throw new Error(`writeFile failed: ${output}`)
  }

  async deleteFile(path: string): Promise<void> {
    await this.sh(`rm -rf ${shellQuote(this.r(path))}`)
  }

  async readdir(path: string): Promise<Array<{ name: string; isDir: boolean }> | null> {
    // `ls -1Ap` lists one-per-line, all entries, with a trailing '/' on dirs.
    const { output, exitCode } = await this.sh(`ls -1Ap ${shellQuote(this.r(path))}`)
    if (exitCode !== 0) return null
    return output
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((name) =>
        name.endsWith('/')
          ? { name: name.slice(0, -1), isDir: true }
          : { name, isDir: false }
      )
  }

  async mkdir(path: string): Promise<void> {
    const abs = this.r(path)
    if (this.client.mkdir) {
      await this.client.mkdir(abs)
      return
    }
    await this.sh(`mkdir -p ${shellQuote(abs)}`)
  }

  async exec(
    command: string,
    _timeoutMs?: number,
    env?: Record<string, string>
  ): Promise<{ output: string; exitCode: number }> {
    const res = await this.client.runCommand({
      cmd: 'sh',
      args: ['-c', command],
      env,
      cwd: this.cwd,
    })
    const out = await toText(res.stdout)
    const err = await toText(res.stderr)
    return {
      output: (out + (err ? (out ? '\n' : '') + err : '')).trimEnd(),
      exitCode: res.exitCode ?? 0,
    }
  }
}

export function createVercelSandbox(client: VercelClientLike, cwd?: string): VercelSandbox {
  return new VercelSandbox(client, cwd)
}
