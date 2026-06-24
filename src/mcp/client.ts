// MCP client for remote servers over the Streamable HTTP transport.
//
// Implements the JSON-RPC handshake (initialize → notifications/initialized) and
// the tools/list + tools/call methods. Browser-safe: uses only global fetch,
// TextDecoder, and ReadableStream.
//
// Transport note: both 'http' and 'sse' configs are driven by POSTing JSON-RPC
// to a single endpoint. A response may come back as a plain JSON body or as a
// `text/event-stream` (SSE) — we handle both and match responses by request id.
// Most MCP servers (including legacy "sse" servers) accept POSTed requests this
// way; the dedicated GET event channel is not required for request/response.

import type {
  JsonRpcResponse,
  McpHttpServerConfig,
  McpSSEServerConfig,
  McpToolInfo,
  McpToolResult,
} from './types.js'
import { applyProxy, type McpProxy } from './proxy.js'

const PROTOCOL_VERSION = '2025-06-18'
const FALLBACK_PROTOCOL_VERSION = '2024-11-05'
const CLIENT_INFO = { name: 'browser-claude-sdk', version: '0.1.0' }

export class McpClient {
  readonly name: string
  /** The actual URL we fetch (target, optionally rewritten through a proxy). */
  private url: string
  private headers: Record<string, string>
  private sessionId: string | null = null
  private nextId = 1
  private connected = false

  constructor(
    config: McpHttpServerConfig | McpSSEServerConfig,
    name: string,
    proxy?: McpProxy
  ) {
    this.name = name
    this.url = applyProxy(config.url, proxy)
    this.headers = { ...(config.headers ?? {}) }
  }

  /** initialize handshake, then send the initialized notification. */
  async connect(signal?: AbortSignal): Promise<void> {
    if (this.connected) return
    let initResult: JsonRpcResponse
    try {
      initResult = await this.request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      }, signal)
    } catch (err) {
      // Retry once with the older protocol version for legacy servers.
      initResult = await this.request('initialize', {
        protocolVersion: FALLBACK_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      }, signal)
    }
    if (initResult.error) {
      throw new Error(`MCP initialize failed: ${initResult.error.message}`)
    }
    await this.notify('notifications/initialized')
    this.connected = true
  }

  async listTools(signal?: AbortSignal): Promise<McpToolInfo[]> {
    const tools: McpToolInfo[] = []
    let cursor: string | undefined
    do {
      const res = await this.request(
        'tools/list',
        cursor ? { cursor } : {},
        signal
      )
      if (res.error) throw new Error(`tools/list failed: ${res.error.message}`)
      const result = (res.result ?? {}) as {
        tools?: McpToolInfo[]
        nextCursor?: string
      }
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
    const res = await this.request(
      'tools/call',
      { name, arguments: args ?? {} },
      signal
    )
    if (res.error) throw new Error(`tools/call (${name}) failed: ${res.error.message}`)
    const result = (res.result ?? { content: [] }) as McpToolResult
    if (!Array.isArray(result.content)) result.content = []
    return result
  }

  // ---- transport ----

  private buildHeaders(): Record<string, string> {
    const h: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...this.headers,
    }
    if (this.sessionId) h['mcp-session-id'] = this.sessionId
    return h
  }

  private async request(
    method: string,
    params: unknown,
    signal?: AbortSignal
  ): Promise<JsonRpcResponse> {
    const id = this.nextId++
    const res = await fetch(this.url, {
      method: 'POST',
      signal,
      headers: this.buildHeaders(),
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    })

    const sid = res.headers.get('mcp-session-id')
    if (sid) this.sessionId = sid

    if (!res.ok) {
      const txt = await res.text().catch(() => res.statusText)
      throw new Error(`MCP HTTP ${res.status} for ${method}: ${txt}`)
    }

    const contentType = res.headers.get('content-type') ?? ''
    if (contentType.includes('text/event-stream') && res.body) {
      return await readSSEForId(res.body, id)
    }
    // Plain JSON response.
    return (await res.json()) as JsonRpcResponse
  }

  /** Fire-and-forget notification (no id, no response expected). */
  private async notify(method: string, params?: unknown): Promise<void> {
    try {
      await fetch(this.url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({ jsonrpc: '2.0', method, params }),
      })
    } catch {
      // Notifications are best-effort.
    }
  }
}

/** Read an SSE body and resolve the first JSON-RPC message matching `id`. */
async function readSSEForId(
  body: ReadableStream<Uint8Array>,
  id: number | string
): Promise<JsonRpcResponse> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data || data === '[DONE]') continue
        try {
          const msg = JSON.parse(data) as JsonRpcResponse
          if (msg && msg.id === id) return msg
        } catch {
          // partial/non-JSON keepalive; keep reading
        }
      }
    }
  } finally {
    reader.releaseLock?.()
  }
  throw new Error(`MCP SSE stream ended without a response for request ${id}`)
}
