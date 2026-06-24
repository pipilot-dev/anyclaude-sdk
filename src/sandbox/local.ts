// Local real-OS sandbox — runs the agent against the actual filesystem and
// shell of the host machine (Node.js), like Claude Code does when executed in a
// working directory. Auto-detects the platform (Windows / macOS / Linux) and
// picks an appropriate shell.
//
// Node-only. All node built-ins are imported lazily inside methods so this file
// can sit in the browser barrel without breaking browser bundles — the node
// code only executes when LocalSandbox is actually used.

import type { Sandbox } from './types.js'

export type Platform = 'windows' | 'mac' | 'linux' | 'unknown'

/** Detect the host platform from process.platform. */
export function detectPlatform(): Platform {
  const p = (globalThis as { process?: { platform?: string } }).process?.platform
  if (p === 'win32') return 'windows'
  if (p === 'darwin') return 'mac'
  if (p === 'linux') return 'linux'
  return 'unknown'
}

export interface LocalSandboxOptions {
  /** Working directory. Defaults to process.cwd(). */
  cwd?: string
  /** Override the shell binary (default: cmd.exe on Windows, $SHELL or /bin/sh elsewhere). */
  shell?: string
  /** Override shell args; the command string is appended as the final arg. */
  shellArgs?: string[]
  /** Extra environment variables merged over process.env. */
  env?: Record<string, string>
}

type FsMod = typeof import('node:fs/promises')
type PathMod = typeof import('node:path')
type CpMod = typeof import('node:child_process')

/**
 * A Sandbox backed by the local OS filesystem and shell. Pair with an Anthropic/
 * OpenAI client and pass to `query()` to run the agent on real files:
 *
 *   const workspace = new LocalSandbox({ cwd: '/path/to/project' })
 *   query({ prompt, workspace, llm })
 */
export class LocalSandbox implements Sandbox {
  readonly cwd: string
  readonly platform: Platform
  private opts: LocalSandboxOptions
  private _fs?: FsMod
  private _path?: PathMod
  private _cp?: CpMod

  constructor(options: LocalSandboxOptions = {}) {
    this.opts = options
    this.platform = detectPlatform()
    // process.cwd() resolved lazily but captured here when available.
    const proc = (globalThis as { process?: { cwd?: () => string } }).process
    this.cwd = options.cwd ?? proc?.cwd?.() ?? '/'
  }

  private async fs(): Promise<FsMod> {
    return (this._fs ??= await import('node:fs/promises'))
  }
  private async path(): Promise<PathMod> {
    return (this._path ??= await import('node:path'))
  }
  private async cp(): Promise<CpMod> {
    return (this._cp ??= await import('node:child_process'))
  }

  private async resolve(p: string): Promise<string> {
    const path = await this.path()
    return path.isAbsolute(p) ? p : path.resolve(this.cwd, p)
  }

  // ---- FileSystem ----

  async readFile(p: string): Promise<string | null> {
    try {
      const fs = await this.fs()
      return await fs.readFile(await this.resolve(p), 'utf-8')
    } catch {
      return null
    }
  }

  async readBinary(p: string): Promise<Uint8Array | null> {
    try {
      const fs = await this.fs()
      const buf = await fs.readFile(await this.resolve(p))
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
    } catch {
      return null
    }
  }

  async writeFile(p: string, contents: string): Promise<void> {
    const fs = await this.fs()
    const path = await this.path()
    const abs = await this.resolve(p)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, contents, 'utf-8')
  }

  async writeBinary(p: string, data: Uint8Array): Promise<void> {
    const fs = await this.fs()
    const path = await this.path()
    const abs = await this.resolve(p)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, data)
  }

  async deleteFile(p: string): Promise<void> {
    const fs = await this.fs()
    await fs.rm(await this.resolve(p), { recursive: true, force: true })
  }

  async readdir(p: string): Promise<Array<{ name: string; isDir: boolean }> | null> {
    try {
      const fs = await this.fs()
      const entries = await fs.readdir(await this.resolve(p), { withFileTypes: true })
      return entries.map((e) => ({ name: e.name, isDir: e.isDirectory() }))
    } catch {
      return null
    }
  }

  async mkdir(p: string): Promise<void> {
    const fs = await this.fs()
    await fs.mkdir(await this.resolve(p), { recursive: true })
  }

  // ---- CommandExecutor ----

  async exec(
    command: string,
    timeoutMs = 120_000,
    env?: Record<string, string>
  ): Promise<{ output: string; exitCode: number }> {
    const cp = await this.cp()
    const proc = (globalThis as { process?: { env?: Record<string, string> } }).process
    const { shell, args } = this.shellFor(command)

    return await new Promise((resolve) => {
      let output = ''
      let settled = false
      const child = cp.spawn(shell, args, {
        cwd: this.cwd,
        env: { ...proc?.env, ...this.opts.env, ...env },
        windowsHide: true,
      })

      const finish = (exitCode: number) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ output: output.trimEnd(), exitCode })
      }

      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
        output += `\n[command timed out after ${timeoutMs}ms]`
        finish(124)
      }, timeoutMs)

      child.stdout?.on('data', (d: Buffer) => (output += d.toString()))
      child.stderr?.on('data', (d: Buffer) => (output += d.toString()))
      child.on('error', (err: Error) => {
        output += `\n[failed to spawn shell: ${err.message}]`
        finish(127)
      })
      child.on('close', (code: number | null) => finish(code ?? 0))
    })
  }

  /** Pick the shell + args for the detected platform (overridable via options). */
  private shellFor(command: string): { shell: string; args: string[] } {
    if (this.opts.shell) {
      return { shell: this.opts.shell, args: [...(this.opts.shellArgs ?? []), command] }
    }
    if (this.platform === 'windows') {
      // cmd.exe is universally present; /d skips AutoRun, /s /c runs the string.
      return { shell: 'cmd.exe', args: ['/d', '/s', '/c', command] }
    }
    const proc = (globalThis as { process?: { env?: Record<string, string> } }).process
    const shell = proc?.env?.SHELL || '/bin/sh'
    return { shell, args: ['-c', command] }
  }
}

export function createLocalSandbox(options?: LocalSandboxOptions): LocalSandbox {
  return new LocalSandbox(options)
}
