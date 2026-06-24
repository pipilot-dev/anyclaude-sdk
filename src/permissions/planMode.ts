// Plan-mode tool classification: in 'plan' mode only read-only tools run.

import { canonical } from './match.js'

export const READ_ONLY_TOOLS = new Set<string>([
  'read_file', 'glob', 'grep', 'list_files',
  'web_fetch', 'web_search', 'tool_search',
  'task_get', 'board_list', 'memory_list',
])

/** Read-only bash command prefixes (program names). */
const READ_ONLY_BASH = [
  'ls', 'cat', 'grep', 'rg', 'find', 'pwd', 'echo', 'head', 'tail', 'wc',
  'which', 'whoami', 'date', 'env', 'tree', 'stat', 'file', 'du', 'df',
]

/** Is this tool call read-only (safe to run in plan mode)? */
export function isReadOnlyTool(toolName: string, input?: Record<string, unknown>): boolean {
  const t = canonical(toolName)
  if (READ_ONLY_TOOLS.has(t)) return true
  if (t === 'config') {
    const action = String(input?.action ?? 'get')
    return action !== 'set'
  }
  if (t === 'bash') {
    const cmd = String(input?.command ?? '').trim().toLowerCase()
    if (!cmd) return false
    // Read-only git subcommands.
    if (/^git\s+(status|diff|log|show|branch|remote|config\s+--get|rev-parse)\b/.test(cmd)) return true
    const prog = cmd.split(/[\s|;&]+/)[0]
    return READ_ONLY_BASH.includes(prog)
  }
  return false
}
