// Rule parsing + matching. Rules use names like "Bash(rm *)" or "write_file";
// we canonicalize tool names (Claude Code PascalCase ↔ our snake_case) and
// glob/prefix-match the rule content against the relevant input field.

import type { PermissionBehavior, PermissionRule, PermissionRuleSet } from './types.js'

// Map common rule/tool name variants → our canonical snake_case tool name.
const ALIAS: Record<string, string> = {
  bash: 'bash', shell: 'bash', sh: 'bash', powershell: 'bash',
  edit: 'edit_file', editfile: 'edit_file',
  multiedit: 'multi_edit',
  write: 'write_file', writefile: 'write_file',
  read: 'read_file', readfile: 'read_file',
  glob: 'glob', grep: 'grep',
  ls: 'list_files', list: 'list_files', listfiles: 'list_files',
  notebookedit: 'notebook_edit',
  todowrite: 'todo_write', todo: 'todo_write',
  webfetch: 'web_fetch', fetch: 'web_fetch',
  websearch: 'web_search', search: 'web_search',
  toolsearch: 'tool_search',
  config: 'config', task: 'task', agent: 'task',
  delete: 'delete_file', deletefile: 'delete_file',
}

/** Canonicalize a tool/rule name so PascalCase rules match snake_case tools. */
export function canonical(name: string): string {
  const lower = name.toLowerCase().trim()
  if (lower.startsWith('mcp__')) return lower // MCP tools match exactly
  const key = lower.replace(/[\s_-]+/g, '')
  return ALIAS[key] ?? lower.replace(/[\s-]+/g, '_')
}

/** Parse a rule string like `Bash(rm *)` or `write_file` into a PermissionRule. */
export function parseRule(s: string): PermissionRule {
  const m = s.match(/^\s*([^()]+?)\s*\(([\s\S]*)\)\s*$/)
  if (m) return { toolName: m[1].trim(), ruleContent: m[2].trim() }
  return { toolName: s.trim() }
}

/** The string a rule's content matches against, by tool. */
export function ruleContentForInput(
  toolName: string,
  input: Record<string, unknown>
): string | undefined {
  const t = canonical(toolName)
  if (t === 'bash') return typeof input.command === 'string' ? input.command : undefined
  if (['read_file', 'write_file', 'edit_file', 'multi_edit', 'delete_file', 'notebook_edit', 'list_files', 'glob'].includes(t)) {
    if (typeof input.path === 'string') return input.path
    if (typeof input.pattern === 'string') return input.pattern
    return undefined
  }
  if (t === 'web_fetch' || t === 'web_search') {
    if (typeof input.url === 'string') return input.url
    if (typeof input.query === 'string') return input.query
    return undefined
  }
  return undefined
}

function escapeRegex(s: string): string {
  // Escape every regex special INCLUDING '*' (so glob '*' becomes '\*' which we
  // then turn into '.*' below — without this, '*'/'**' stay as invalid quantifiers).
  return s.replace(/[.*+^${}()|[\]\\]/g, '\\$&')
}

/** Glob/prefix match for rule content (`*`/`**` = any; bare strings prefix-match commands). */
export function matchContent(pattern: string | undefined, value: string | undefined): boolean {
  if (!pattern) return true // no content constraint → matches any input
  if (value == null) return false
  if (pattern === '*' || pattern === '**') return true
  const re = new RegExp('^' + escapeRegex(pattern).replace(/\\\*\\\*/g, '.*').replace(/\\\*/g, '.*') + '$')
  if (re.test(value)) return true
  // Convenience: a glob-free pattern prefix-matches a command/path.
  if (!pattern.includes('*') && (value === pattern || value.startsWith(pattern + ' ') || value.startsWith(pattern + '/'))) {
    return true
  }
  return false
}

/** Does a rule match this tool call? */
export function matchRule(
  rule: PermissionRule,
  toolName: string,
  input: Record<string, unknown>
): boolean {
  if (canonical(rule.toolName) !== canonical(toolName)) return false
  if (!rule.ruleContent) return true
  return matchContent(rule.ruleContent, ruleContentForInput(toolName, input))
}

/** Evaluate a ruleset: deny wins, then allow, then ask; undefined if no match. */
export function evaluate(
  ruleset: PermissionRuleSet,
  toolName: string,
  input: Record<string, unknown>
): PermissionBehavior | undefined {
  if (ruleset.deny.some((r) => matchRule(r, toolName, input))) return 'deny'
  if (ruleset.allow.some((r) => matchRule(r, toolName, input))) return 'allow'
  if (ruleset.ask.some((r) => matchRule(r, toolName, input))) return 'ask'
  return undefined
}

/** Build a PermissionRuleSet from string-rule arrays. */
export function ruleSetFromStrings(input: {
  allow?: string[]
  deny?: string[]
  ask?: string[]
}): PermissionRuleSet {
  return {
    allow: (input.allow ?? []).map(parseRule),
    deny: (input.deny ?? []).map(parseRule),
    ask: (input.ask ?? []).map(parseRule),
  }
}
