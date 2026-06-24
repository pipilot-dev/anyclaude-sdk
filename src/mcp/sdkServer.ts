// In-process ("SDK") MCP servers. Define tools in plain JS that run in the same
// process as the agent — no network, no transport. Mirrors the official SDK's
// createSdkMcpServer / tool() helpers.

import type {
  McpSdkServerConfig,
  McpToolResult,
  SdkMcpServer,
  SdkMcpTool,
} from './types.js'

/**
 * Ergonomic builder for an in-process MCP tool.
 *
 * @example
 * tool('add', 'Add two numbers',
 *   { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a','b'] },
 *   async ({ a, b }) => ({ content: [{ type: 'text', text: String((a as number) + (b as number)) }] })
 * )
 */
export function tool(
  name: string,
  description: string,
  inputSchema: SdkMcpTool['inputSchema'],
  handler: (args: Record<string, unknown>) => Promise<McpToolResult> | McpToolResult
): SdkMcpTool {
  return { name, description, inputSchema, handler }
}

/**
 * Create an in-process MCP server config that can be passed to query() via
 * `mcpServers`. Its tools run locally and appear to the model as
 * `mcp__<name>__<toolName>`.
 */
export function createSdkMcpServer(opts: {
  name: string
  version?: string
  tools: SdkMcpTool[]
}): McpSdkServerConfig {
  const server: SdkMcpServer = {
    name: opts.name,
    version: opts.version,
    tools: opts.tools,
  }
  return { type: 'sdk', name: opts.name, server }
}
