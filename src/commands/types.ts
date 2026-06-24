// Slash-command system types. Ports Claude Code's /compact, /clear, /help, etc.
// The agent loop invokes runSlashCommand() when a user message is a string that
// starts with '/'. A command returns a SlashOutcome describing what the loop
// should do (surface text, expand into a prompt, and/or rewrite history).

import type { ChatMsg, Usage } from '../types/index.js'

/** Minimal structural view of the LLM client a command may use (e.g. /compact). */
export interface CommandLLM {
  streamChat(
    messages: ChatMsg[],
    opts: {
      model?: string
      signal?: AbortSignal
      onToken: (delta: string) => void
    }
  ): Promise<{ text: string }>
}

export interface SlashCommandContext {
  /** Live reference to the conversation history (history[0] is the system msg). Read-only intent. */
  history: ChatMsg[]
  /** Tools currently available to the agent. */
  tools: Array<{ name: string; description: string }>
  /** Active model id, if known. */
  model?: string
  /** Working directory. */
  cwd: string
  /** Accumulated token usage so far, if tracked. */
  usage?: Usage
  /** Mutable session state. */
  store?: { todos: unknown[] }
  /** Abort signal for long-running commands (e.g. /compact). */
  signal?: AbortSignal
  /** LLM client, when available (required by /compact). */
  llm?: CommandLLM
  /** The full merged command registry (built-ins + user commands), for /help. */
  commands: SlashCommand[]

  // --- Optional agent state (populated by the loop when available) ---
  /** Current session id. */
  sessionId?: string
  /** Session store, for /sessions, /resume, /rename. */
  sessionStore?: import('../session/types.js').SessionStoreLike
  /** Paths the model has read this session, for /files. */
  readFiles?: Set<string>
  /** Configured sub-agents, for /agents. */
  agents?: Record<string, { description: string; model?: string }>
  /** MCP server statuses, for /mcp. */
  mcpServers?: Array<{ name: string; status: string }>
  /** Active permission mode, for /permissions. */
  permissionMode?: string
  /** Background tasks, for /tasks. */
  background?: { list(): Array<{ id: string; status: string; description: string }> }
  /** Team task board, for /board. */
  board?: { list(): Array<{ id: string; status: string; owner?: string; subject: string }> }
  /** Shell executor, for /diff. */
  exec?: (command: string) => Promise<{ output: string; exitCode: number }>
  /** Filesystem, for /memory. */
  fs?: { readFile(path: string): Promise<string | null> }
  /** Persistent memory store, for /memory. */
  memory?: { render(): Promise<string> }
}

export interface SlashOutcome {
  /** Text surfaced to the user as a system `local_command_output` message. */
  systemText?: string
  /** Replace the user's turn with this prompt and run the LLM normally. */
  expandedPrompt?: string
  /** Replace the entire conversation history verbatim (include the system message). */
  newHistory?: ChatMsg[]
  /** Signals a compaction happened (loop emits a compact_boundary message). */
  compacted?: boolean
}

export interface SlashCommand {
  name: string
  description: string
  argumentHint?: string
  run(args: string, ctx: SlashCommandContext): Promise<SlashOutcome> | SlashOutcome
}
