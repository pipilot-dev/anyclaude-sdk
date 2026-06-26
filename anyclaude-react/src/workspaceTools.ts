// createWorkspaceClientTools — run the SDK's built-in workspace tools
// (read/write/edit/multi_edit/delete/list/glob/grep, and bash when a shell is
// available) on the HOST instead of the server. Pair with the server-side
// `query({ clientTools: WORKSPACE_TOOL_NAMES })`: the agent emits a
// `client_tool_request`, this map executes it against the chosen workspace —
// a browser WebContainer, an IndexedDB `DexieFileSystem`, OPFS, or memory — and
// the result is streamed back. Reuses the real SDK tool implementations, so the
// behavior matches server-side exactly.
import {
  bash,
  readFile,
  writeFile,
  editFile,
  multiEdit,
  deleteFile,
  listFiles,
  glob,
  grep,
  type Tool,
  type ToolContext,
  type ToolResult,
} from 'anyclaude-sdk/tools'
import { WebContainerWorkspace } from 'anyclaude-sdk/workspace'
import type { ClientToolMap } from './client.js'

/** Structural view of an SDK workspace: a FileSystem, optionally a shell.
 *  `DexieFileSystem`, `WebContainerWorkspace`, `OpfsFileSystem`,
 *  `MemoryFileSystem` all satisfy this. */
export interface WorkspaceLike {
  readFile(path: string): Promise<string | null>
  writeFile(path: string, contents: string): Promise<void>
  readdir(path: string): Promise<Array<{ name: string; isDir: boolean }> | null>
  deleteFile(path: string): Promise<void>
  mkdir?(path: string): Promise<void>
  readBinary?(path: string): Promise<Uint8Array | null>
  writeBinary?(path: string, data: Uint8Array): Promise<void>
  /** Present on shell-capable workspaces (e.g. WebContainerWorkspace). */
  exec?(command: string, timeoutMs?: number): Promise<{ output: string; exitCode: number }>
  cwd?: string
}

export interface WorkspaceClientToolsOptions {
  /** Working directory for the tools (default: workspace.cwd ?? '/'). */
  cwd?: string
  /** Restrict to these tool names (default: all supported by the workspace). */
  only?: string[]
  /** Extra or overriding executors, merged on top of the generated map. */
  extra?: ClientToolMap
}

const WORKSPACE_TOOLS: Tool[] = [bash, writeFile, readFile, editFile, multiEdit, deleteFile, listFiles, glob, grep]

const NOOP_EXEC = {
  async exec() {
    return { output: 'No shell available in this workspace (filesystem-only).', exitCode: 127 }
  },
}

/**
 * Build a `ClientToolMap` that executes the SDK's built-in workspace tools
 * against any SDK workspace. `bash` is included only when the workspace has a
 * shell (`exec`); filesystem-only workspaces (e.g. IndexedDB) omit it.
 *
 *   useAgent({ endpoint: '/api/agent',
 *     clientTools: createWorkspaceClientTools(new DexieFileSystem('my-db')) })
 */
export function createWorkspaceClientTools(
  workspace: WorkspaceLike,
  opts: WorkspaceClientToolsOptions = {}
): ClientToolMap {
  const hasExec = typeof workspace.exec === 'function'
  const ctx = {
    fs: workspace,
    exec: hasExec ? workspace : NOOP_EXEC,
    cwd: opts.cwd ?? workspace.cwd ?? '/',
    readFiles: new Set<string>(),
  } as unknown as ToolContext

  const map: ClientToolMap = {}
  for (const t of WORKSPACE_TOOLS) {
    const name = t.def.function.name
    if (opts.only && !opts.only.includes(name)) continue
    if (name === 'bash' && !hasExec) continue
    if (!t.run) continue // built-in workspace tools always have a run; guards the now-optional type
    const run = t.run
    map[name] = async (input: Record<string, unknown>) => {
      const r: ToolResult = await run(input, ctx)
      return { content: r.content as unknown, is_error: r.isError }
    }
  }
  return { ...map, ...(opts.extra ?? {}) }
}

/**
 * Convenience: client tools backed by a booted WebContainer — real files + a
 * real `jsh` shell, all in the browser tab.
 *
 *   const wc = await WebContainer.boot()
 *   useAgent({ endpoint: '/api/agent', clientTools: createWebContainerClientTools(wc) })
 */
export function createWebContainerClientTools(
  wc: ConstructorParameters<typeof WebContainerWorkspace>[0],
  opts: WorkspaceClientToolsOptions = {}
): ClientToolMap {
  const ws = new WebContainerWorkspace(wc, opts.cwd) as unknown as WorkspaceLike
  return createWorkspaceClientTools(ws, opts)
}
