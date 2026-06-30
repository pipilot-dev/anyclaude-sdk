// MCP client for local servers over the stdio transport — the form Claude Code
// and most MCP servers ship as (`npx -y @modelcontextprotocol/server-filesystem …`,
// `uvx mcp-server-git`, etc.). We spawn the command as a child process and speak
// newline-delimited JSON-RPC 2.0 over its stdin/stdout (stderr is logging).
//
// Node/Bun only: `node:child_process` is imported LAZILY so this module stays out
// of browser bundles and a browser caller gets a clean "not available" failure
// instead of a build error. The child is `unref()`-ed (never blocks process exit)
// and killed on abort or close().

import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type {
  JsonRpcResponse,
  McpStdioServerConfig,
  McpToolInfo,
  McpToolResult,
} from './types.js'

const PROTOCOL_VERSION = '2025-06-18'
const FALLBACK_PROTOCOL_VERSION = '2024-11-05'
const CLIENT_INFO = { name: 'browser-claude-sdk', version: '0.1.0' }

type Pending = { resolve: (r: JsonRpcResponse) => void; reject: (e: Error) => void }

export class StdioMcpClient {
  readonly name: string
  private readonly config: McpStdioServerConfig
  private child: ChildProcessWithoutNullStreams | null = null
  private nextId = 1
  private connected = false
  private buffer = ''
  private readonly pending = new Map<number | string, Pending>()
  private exited: Error | null = null
  private onAbort?: () => void
  private abortSignal?: AbortSignal

  constructor(config: McpStdioServerConfig, name: string) {
    this.name = name
    this.config = config
  }

  async connect(signal?: AbortSignal): Promise<void> {
    if (this.connected) return
    await this.spawn(signal)
    let init: JsonRpcResponse
    try {
      init = await this.request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      }, signal)
    } catch {
      init = await this.request('initialize', {
        protocolVersion: FALLBACK_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      }, signal)
    }
    if (init.error) throw new Error(`MCP initialize failed: ${init.error.message}`)
    this.notify('notifications/initialized')
    this.connected = true
  }

  async listTools(signal?: AbortSignal): Promise<McpToolInfo[]> {
    const tools: McpToolInfo[] = []
    let cursor: string | undefined
    do {
      const res = await this.request('tools/list', cursor ? { cursor } : {}, signal)
      if (res.error) throw new Error(`tools/list failed: ${res.error.message}`)
      const result = (res.result ?? {}) as { tools?: McpToolInfo[]; nextCursor?: string }
      if (Array.isArray(result.tools)) tools.push(...result.tools)
      cursor = result.nextCursor
    } while (cursor)
    return tools
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<McpToolResult> {
    const res = await this.request('tools/call', { name, arguments: args ?? {} }, signal)
    if (res.error) throw new Error(`tools/call (${name}) failed: ${res.error.message}`)
    const result = (res.result ?? { content: [] }) as McpToolResult
    if (!Array.isArray(result.content)) result.content = []
    return result
  }

  /** Kill the child and reject any in-flight requests. Safe to call repeatedly. */
  close(): void {
    if (this.abortSignal && this.onAbort) this.abortSignal.removeEventListener('abort', this.onAbort)
    const err = new Error('MCP stdio client closed')
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
    try {
      this.child?.kill()
    } catch {
      /* ignore */
    }
    this.child = null
    this.connected = false
  }

  // ---- transport ----

  private async spawn(signal?: AbortSignal): Promise<void> {
    let cp: typeof import('node:child_process')
    try {
      cp = await import('node:child_process')
    } catch {
      throw new Error('stdio MCP servers require Node/Bun (node:child_process unavailable in this runtime)')
    }
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    const child = cp.spawn(this.config.command, this.config.args ?? [], {
      cwd: this.config.cwd,
      env: { ...(proc?.env ?? {}), ...(this.config.env ?? {}) } as NodeJS.ProcessEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams
    this.child = child
    // Never let the child keep the parent process alive.
    child.unref?.()
    child.stdin.on('error', () => {/* broken pipe after exit */})

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.onData(chunk))
    child.on('error', (e: Error) => this.fail(new Error(`MCP server '${this.name}' failed to start: ${e.message}`)))
    child.on('exit', (code: number | null) =>
      this.fail(new Error(`MCP server '${this.name}' exited${code != null ? ` (code ${code})` : ''}`))
    )

    if (signal) {
      this.abortSignal = signal
      this.onAbort = () => this.close()
      if (signal.aborted) this.close()
      else signal.addEventListener('abort', this.onAbort, { once: true })
    }
  }

  /** Reject all pending requests and mark the transport dead. */
  private fail(err: Error): void {
    this.exited = err
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
  }

  /** Accumulate stdout and dispatch each complete newline-delimited JSON message. */
  private onData(chunk: string): void {
    this.buffer += chunk
    let nl: number
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl).trim()
      this.buffer = this.buffer.slice(nl + 1)
      if (!line) continue
      let msg: JsonRpcResponse
      try {
        msg = JSON.parse(line) as JsonRpcResponse
      } catch {
        continue // server log line on stdout, or partial — skip
      }
      if (msg.id == null) continue // a notification from the server
      const p = this.pending.get(msg.id)
      if (p) {
        this.pending.delete(msg.id)
        p.resolve(msg)
      }
    }
  }

  private request(method: string, params: unknown, signal?: AbortSignal): Promise<JsonRpcResponse> {
    if (this.exited) return Promise.reject(this.exited)
    const child = this.child
    if (!child) return Promise.reject(new Error('MCP stdio transport not connected'))
    const id = this.nextId++
    const timeoutMs = this.config.timeoutMs ?? 60_000
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const onAbort = () => settle(() => reject(new Error('aborted')))
      const settle = (fn: () => void) => {
        if (timer) clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        this.pending.delete(id)
        fn()
      }
      this.pending.set(id, {
        resolve: (r) => settle(() => resolve(r)),
        reject: (e) => settle(() => reject(e)),
      })
      if (signal) {
        if (signal.aborted) return settle(() => reject(new Error('aborted')))
        signal.addEventListener('abort', onAbort, { once: true })
      }
      timer = setTimeout(
        () => settle(() => reject(new Error(`MCP '${method}' timed out after ${timeoutMs}ms`))),
        timeoutMs
      )
      try {
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
      } catch (e) {
        settle(() => reject(e instanceof Error ? e : new Error(String(e))))
      }
    })
  }

  private notify(method: string, params?: unknown): void {
    try {
      this.child?.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
    } catch {
      /* best-effort */
    }
  }
}
