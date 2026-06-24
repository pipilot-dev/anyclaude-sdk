import type { CommandExecutor, FileSystem } from '../types/index.js'

// Minimal structural typing of the bits of @webcontainer/api we use, so this
// package does not need a hard dependency on it (it is an optional peer dep).
export interface WebContainerLike {
  fs: {
    readFile(path: string): Promise<Uint8Array>
    readFile(path: string, encoding: 'utf-8'): Promise<string>
    writeFile(path: string, data: string | Uint8Array): Promise<void>
    readdir(
      path: string,
      options?: { withFileTypes?: boolean }
    ): Promise<string[] | Array<{ name: string; isDirectory(): boolean }>>
    mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
    rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
  }
  spawn(
    command: string,
    args?: string[],
    options?: { env?: Record<string, string>; cwd?: string }
  ): Promise<WebContainerProcess>
  workdir?: string
}

export interface WebContainerProcess {
  output: ReadableStream<string>
  exit: Promise<number>
  kill(): void
}

const textDecoder = new TextDecoder()

/**
 * Wraps a booted WebContainer instance, exposing the `FileSystem` and
 * `CommandExecutor` interfaces the agent loop and tools depend on.
 *
 * All paths are resolved relative to `cwd` (default: the container workdir or
 * "/home/projects" — the standard WebContainer mount point) when not absolute.
 */
export class WebContainerWorkspace implements FileSystem, CommandExecutor {
  readonly wc: WebContainerLike
  readonly cwd: string

  constructor(wc: WebContainerLike, cwd?: string) {
    this.wc = wc
    this.cwd = cwd ?? wc.workdir ?? '/home/projects'
  }

  /** Resolve a possibly-relative path against the workspace cwd. */
  resolve(path: string): string {
    if (path.startsWith('/')) return normalize(path)
    const base = this.cwd.endsWith('/') ? this.cwd.slice(0, -1) : this.cwd
    return normalize(`${base}/${path}`)
  }

  // ---- FileSystem ----

  async readFile(path: string): Promise<string | null> {
    try {
      return await this.wc.fs.readFile(this.resolve(path), 'utf-8')
    } catch {
      return null
    }
  }

  async readBinary(path: string): Promise<Uint8Array | null> {
    try {
      return await this.wc.fs.readFile(this.resolve(path))
    } catch {
      return null
    }
  }

  async writeFile(path: string, contents: string): Promise<void> {
    const resolved = this.resolve(path)
    await this.ensureParent(resolved)
    await this.wc.fs.writeFile(resolved, contents)
  }

  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    const resolved = this.resolve(path)
    await this.ensureParent(resolved)
    await this.wc.fs.writeFile(resolved, data)
  }

  async deleteFile(path: string): Promise<void> {
    await this.wc.fs.rm(this.resolve(path), { recursive: true, force: true })
  }

  async readdir(path: string): Promise<Array<{ name: string; isDir: boolean }> | null> {
    try {
      const entries = await this.wc.fs.readdir(this.resolve(path), {
        withFileTypes: true,
      })
      return (entries as Array<{ name: string; isDirectory(): boolean }>).map((e) => ({
        name: e.name,
        isDir: e.isDirectory(),
      }))
    } catch {
      return null
    }
  }

  async mkdir(path: string): Promise<void> {
    await this.wc.fs.mkdir(this.resolve(path), { recursive: true })
  }

  private async ensureParent(resolvedPath: string): Promise<void> {
    const idx = resolvedPath.lastIndexOf('/')
    if (idx <= 0) return
    const parent = resolvedPath.slice(0, idx)
    try {
      await this.wc.fs.mkdir(parent, { recursive: true })
    } catch {
      // best-effort; writeFile will surface a real error if it matters
    }
  }

  // ---- CommandExecutor ----

  async exec(
    command: string,
    timeoutMs = 120_000,
    env?: Record<string, string>
  ): Promise<{ output: string; exitCode: number }> {
    const sanitized = sanitizeCommand(command)
    const proc = await this.wc.spawn('jsh', ['-c', sanitized], {
      env,
      cwd: this.cwd,
    })

    let output = ''
    const reader = proc.output.getReader()
    const collect = (async () => {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        output += typeof value === 'string' ? value : textDecoder.decode(value)
      }
    })()

    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<number>((res) => {
      timer = setTimeout(() => {
        timedOut = true
        try {
          proc.kill()
        } catch {
          /* ignore */
        }
        res(124)
      }, timeoutMs)
    })

    const exitCode = await Promise.race([proc.exit, timeout])
    if (timer) clearTimeout(timer)
    try {
      await collect
    } catch {
      /* stream may close on kill */
    }
    reader.releaseLock?.()

    if (timedOut) {
      output += `\n[command timed out after ${timeoutMs}ms]`
    }
    return { output: output.trimEnd(), exitCode }
  }
}

/**
 * jsh is a constrained shell. Strip constructs it doesn't support so commands
 * authored for a real bash shell still run (mirrors the spec's bash notes).
 */
export function sanitizeCommand(command: string): string {
  return command
    .replace(/\s*2>&1/g, '')
    .replace(/\s*>\s*\/dev\/null(\s+2>&1)?/g, '')
    .replace(/\s*2>\s*\/dev\/null/g, '')
    .trim()
}

/** Collapse `.`/`..` segments and duplicate slashes in an absolute path. */
function normalize(path: string): string {
  const isAbs = path.startsWith('/')
  const out: string[] = []
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop()
      else if (!isAbs) out.push('..')
    } else {
      out.push(seg)
    }
  }
  return (isAbs ? '/' : '') + out.join('/')
}
