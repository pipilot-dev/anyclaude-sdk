// Sandbox provider abstraction. A Sandbox is just a FileSystem plus a
// CommandExecutor — the same `Workspace` the agent loop consumes. Adapters wrap
// each provider's client (WebContainer, E2B, Vercel, Daytona, Cloudflare, …)
// without a hard dependency on their SDKs (structural typing).

import type { CommandExecutor, FileSystem } from '../types/index.js'
import { resolvePath } from '../util/paths.js'

export type ExecResult = { output: string; exitCode: number }

/** A runnable workspace: files + commands, optionally rooted at a cwd. */
export interface Sandbox extends FileSystem, CommandExecutor {
  readonly cwd?: string
  /** Optional lifecycle hooks (some providers need explicit setup/teardown). */
  init?(): Promise<void>
  dispose?(): Promise<void>
}

/**
 * Mix any FileSystem with any CommandExecutor into a single Sandbox. Useful for
 * pairing a persistent local FS (Dexie/OPFS) with a remote shell, or a
 * file-only agent (with NoopCommandExecutor).
 */
export function composeWorkspace(
  fs: FileSystem,
  exec: CommandExecutor,
  cwd?: string
): Sandbox {
  // When a cwd is given it is authoritative: relative paths resolve against it
  // before hitting the underlying FS (whose own cwd may differ). Absolute paths
  // pass through unchanged.
  const r = cwd ? (p: string) => resolvePath(cwd, p) : (p: string) => p
  return {
    cwd,
    readFile: (p) => fs.readFile(r(p)),
    readBinary: (p) => fs.readBinary(r(p)),
    writeFile: (p, c) => fs.writeFile(r(p), c),
    writeBinary: (p, d) => fs.writeBinary(r(p), d),
    deleteFile: (p) => fs.deleteFile(r(p)),
    readdir: (p) => fs.readdir(r(p)),
    mkdir: (p) => fs.mkdir(r(p)),
    exec: (cmd, timeoutMs, env) => exec.exec(cmd, timeoutMs, env),
  }
}
