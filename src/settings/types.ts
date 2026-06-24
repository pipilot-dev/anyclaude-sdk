// Settings types — a browser-friendly port of Claude Code's settings.json.
// Sources cascade user < project < local (highest precedence last).

export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'plan'
  | 'dontAsk'

export type SettingsSource = 'user' | 'project' | 'local'

export type Settings = {
  model?: string
  permissionMode?: PermissionMode
  /** Permission rule strings (e.g. "Bash(rm *)", "Read"). */
  allow?: string[]
  deny?: string[]
  ask?: string[]
  /** Tool name allow/deny lists. */
  allowedTools?: string[]
  disallowedTools?: string[]
  appendSystemPrompt?: string
  maxTurns?: number
  env?: Record<string, string>
  [key: string]: unknown
}
