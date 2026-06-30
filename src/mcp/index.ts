// MCP integration: load tools from external (HTTP/SSE) and in-process (SDK)
// MCP servers, wrapped as native browser-claude-sdk `Tool`s so they drop
// straight into the agent's tool list.

import type { ContentBlockParam, ToolDef } from '../types/index.js'
import type { Tool, ToolResult } from '../tools/types.js'
import { McpClient } from './client.js'
import { StdioMcpClient } from './stdio.js'
import type {
  McpContentBlock,
  McpServers,
  McpServerStatus,
  McpToolInfo,
  McpToolResult,
  SdkMcpTool,
} from './types.js'

export * from './types.js'
export { McpClient } from './client.js'
export { StdioMcpClient } from './stdio.js'
export { applyProxy, type McpProxy } from './proxy.js'
export { tool, createSdkMcpServer } from './sdkServer.js'

import type { McpProxy } from './proxy.js'

/** Options for loadMcpServers. */
export interface LoadMcpOptions {
  signal?: AbortSignal
  /** Route remote (http/sse) MCP requests through a proxy (browser CORS). */
  proxy?: McpProxy
}

/** Tool name namespacing: mcp__<server>__<tool>, matching the official SDK. */
export function mcpToolName(server: string, toolName: string): string {
  return `mcp__${server}__${toolName}`
}

/** Coerce an MCP inputSchema into our OpenAI-shape parameters object. */
function toToolParameters(schema: McpToolInfo['inputSchema'] | undefined): ToolDef['function']['parameters'] {
  const s = schema ?? {}
  return {
    type: 'object',
    properties: (s.properties as Record<string, unknown>) ?? {},
    ...(Array.isArray(s.required) ? { required: s.required } : {}),
  }
}

/** Map an MCP tool result's content blocks to our ContentBlockParam[]. */
function mapMcpContent(result: McpToolResult): ToolResult {
  const blocks: ContentBlockParam[] = []
  for (const c of result.content ?? []) {
    const block = c as McpContentBlock
    if (block.type === 'text' && typeof (block as { text?: string }).text === 'string') {
      blocks.push({ type: 'text', text: (block as { text: string }).text })
    } else if (block.type === 'image' || block.type === 'audio') {
      const b = block as { data?: string; mimeType?: string }
      if (typeof b.data === 'string') {
        // Audio isn't a first-class block for us; surface images natively and
        // note audio as text so nothing is silently dropped.
        if (block.type === 'image') {
          blocks.push({
            type: 'image',
            source: { type: 'base64', media_type: b.mimeType ?? 'image/png', data: b.data },
          })
        } else {
          blocks.push({ type: 'text', text: `[audio: ${b.mimeType ?? 'audio'} omitted]` })
        }
      }
    } else if (block.type === 'resource') {
      const r = (block as { resource?: { text?: string; uri?: string } }).resource
      if (r?.text) blocks.push({ type: 'text', text: r.text })
      else if (r?.uri) blocks.push({ type: 'text', text: `[resource: ${r.uri}]` })
    } else {
      // Unknown block kind — stringify so it isn't lost.
      try {
        blocks.push({ type: 'text', text: JSON.stringify(block) })
      } catch {
        /* skip */
      }
    }
  }
  if (!blocks.length) blocks.push({ type: 'text', text: '(no content)' })
  return { content: blocks, isError: result.isError || undefined }
}

function wrapSdkTool(serverName: string, t: SdkMcpTool): Tool {
  return {
    def: {
      type: 'function',
      function: {
        name: mcpToolName(serverName, t.name),
        description: t.description,
        parameters: toToolParameters(t.inputSchema),
      },
    },
    async run(input) {
      try {
        const res = await t.handler(input)
        return mapMcpContent(res)
      } catch (err) {
        return {
          content: `MCP error: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        }
      }
    },
  }
}

/** Anything that can invoke an MCP tool — McpClient (http/sse) or StdioMcpClient. */
interface McpToolCaller {
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpToolResult>
}

function wrapRemoteTool(serverName: string, client: McpToolCaller, info: McpToolInfo): Tool {
  return {
    def: {
      type: 'function',
      function: {
        name: mcpToolName(serverName, info.name),
        description: info.description ?? `MCP tool ${info.name}`,
        parameters: toToolParameters(info.inputSchema),
      },
    },
    async run(input, ctx) {
      try {
        const res = await client.callTool(info.name, input, ctx.signal)
        return mapMcpContent(res)
      } catch (err) {
        return {
          content: `MCP error: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        }
      }
    },
  }
}

/**
 * Load every configured MCP server and return their tools (wrapped as native
 * Tools) plus per-server connection status. Never throws — a server that fails
 * to connect contributes a 'failed' status and no tools.
 */
export async function loadMcpServers(
  servers: McpServers,
  opts: AbortSignal | LoadMcpOptions = {}
): Promise<{ tools: Tool[]; statuses: McpServerStatus[] }> {
  // Back-compat: accept a bare AbortSignal as the second arg.
  const options: LoadMcpOptions =
    opts && typeof (opts as AbortSignal).aborted === 'boolean'
      ? { signal: opts as AbortSignal }
      : (opts as LoadMcpOptions)
  const signal = options.signal
  const proxy = options.proxy

  const tools: Tool[] = []
  const statuses: McpServerStatus[] = []

  for (const [name, config] of Object.entries(servers)) {
    if (config.type === 'sdk') {
      const wrapped = config.server.tools.map((t) => wrapSdkTool(name, t))
      tools.push(...wrapped)
      statuses.push({
        name,
        status: 'connected',
        tools: config.server.tools.map((t) => t.name),
      })
      continue
    }

    // Local stdio (spawned child process; Node/Bun only).
    if (config.type === 'stdio') {
      try {
        const client = new StdioMcpClient(config, name)
        await client.connect(signal)
        const infos = await client.listTools(signal)
        tools.push(...infos.map((info) => wrapRemoteTool(name, client, info)))
        statuses.push({ name, status: 'connected', tools: infos.map((i) => i.name) })
      } catch (err) {
        statuses.push({
          name,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        })
      }
      continue
    }

    // Remote (http / sse).
    try {
      const client = new McpClient(config, name, proxy)
      await client.connect(signal)
      const infos = await client.listTools(signal)
      tools.push(...infos.map((info) => wrapRemoteTool(name, client, info)))
      statuses.push({ name, status: 'connected', tools: infos.map((i) => i.name) })
    } catch (err) {
      statuses.push({
        name,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { tools, statuses }
}
