// Model Context Protocol (MCP) types for browser-claude-sdk.
//
// Covers server configuration (remote HTTP/SSE + in-process "SDK" servers),
// the JSON-RPC 2.0 envelope, and the MCP tool/result shapes we consume.

// ---- Server configuration ----

export interface McpHttpServerConfig {
  type: 'http'
  url: string
  headers?: Record<string, string>
}

export interface McpSSEServerConfig {
  type: 'sse'
  url: string
  headers?: Record<string, string>
}

export interface McpSdkServerConfig {
  type: 'sdk'
  name: string
  server: SdkMcpServer
}

export type McpServerConfig =
  | McpHttpServerConfig
  | McpSSEServerConfig
  | McpSdkServerConfig

/** Map of server name → configuration. The key is the server's name. */
export type McpServers = Record<string, McpServerConfig>

// ---- In-process SDK server ----

export interface SdkMcpTool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties?: Record<string, unknown>
    required?: string[]
  }
  handler(args: Record<string, unknown>): Promise<McpToolResult> | McpToolResult
}

export interface SdkMcpServer {
  name: string
  version?: string
  tools: SdkMcpTool[]
}

// ---- JSON-RPC 2.0 ----

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: number | string
  method: string
  params?: unknown
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0'
  id: number | string | null
  result?: T
  error?: { code: number; message: string; data?: unknown }
}

// ---- MCP tool & result shapes ----

export interface McpToolInfo {
  name: string
  description?: string
  inputSchema: {
    type?: string
    properties?: Record<string, unknown>
    required?: string[]
    [k: string]: unknown
  }
}

export type McpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'audio'; data: string; mimeType: string }
  | { type: 'resource'; resource: { uri?: string; text?: string; mimeType?: string; blob?: string } }
  | { type: string; [k: string]: unknown }

export interface McpToolResult {
  content: McpContentBlock[]
  isError?: boolean
}

// ---- Status ----

export interface McpServerStatus {
  name: string
  status: 'connected' | 'failed' | 'pending'
  error?: string
  tools?: string[]
}
