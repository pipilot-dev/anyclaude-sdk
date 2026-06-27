// Tool system types for browser-claude-sdk.
import type {
  AgentStore,
  CommandExecutor,
  ContentBlockParam,
  FileSystem,
  ToolDef,
} from '../types/index.js'

/** Tunable caps for the read_file tool. */
export interface FileReadLimits {
  /** Max total file size in bytes before a text read is rejected. Default 256 KB. */
  maxSizeBytes: number
  /** Max output tokens (rough estimate) before a text read is rejected. Default 25000. */
  maxTokens: number
  /** Max image bytes after downsampling. Default ~3.75 MB. */
  maxImageBytes: number
  /** Max PDF pages returned per read. Default 20. */
  maxPdfPages: number
}

/**
 * Execution context handed to every tool. The agent loop owns the lifetime of
 * `readFiles` (the set of paths the model has read this session) so that
 * edit_file can enforce the "read before edit" rule.
 */
export interface ToolContext {
  fs: FileSystem
  exec: CommandExecutor
  cwd: string
  readFiles: Set<string>
  signal?: AbortSignal
  /** Mutable session state (e.g. todos). The agent loop owns its lifetime. */
  store?: AgentStore
  /** Optional read limits; tools fall back to sensible defaults when omitted. */
  limits?: Partial<FileReadLimits>
  /**
   * Spawn a sub-agent to completion and return its final text. Provided by the
   * agent loop when sub-agents are enabled; the `task` tool relies on it.
   */
  runSubagent?: (opts: {
    description: string
    prompt: string
    agentType?: string
    /** Abort signal (e.g. a background task's stop) — cancels the sub-agent. */
    signal?: AbortSignal
    /** Streamed progress (assistant text + tool names) as the sub-agent works. */
    onProgress?: (text: string) => void
  }) => Promise<{ text: string; isError?: boolean }>
  /** Ask the user a multiple-choice question (wired from query({ onAskUser })). */
  askUser?: (q: {
    question: string
    header?: string
    options: Array<{ label: string; description?: string }>
    multiSelect?: boolean
  }) => Promise<string | string[]>
  /** Background task manager, present when background tasks are enabled. */
  background?: import('../background/manager.js').BackgroundTaskManager
  /** Inter-agent mailbox, present when teammates are enabled. Shared with sub-agents. */
  mailbox?: import('../team/mailbox.js').Mailbox
  /** Shared task board, present when teammates are enabled. Shared with sub-agents. */
  board?: import('../team/taskBoard.js').TaskBoard
  /** This agent's name/label (e.g. 'coordinator' or a sub-agent type) for messaging. */
  agentName?: string
  /** Index of all tools available this session (name + description), for tool_search. */
  toolIndex?: Array<{ name: string; description: string }>
  /** Persistent memory store, present when memory is enabled. Shared with sub-agents. */
  memory?: import('../memory/store.js').MemoryStore
  /** Available skills (markdown prompt templates), for the `skill` tool. */
  skills?: import('../skills/index.js').Skill[]
  /** Plan-mode state; when active, mutating tools are denied. */
  planMode?: { active: boolean }
  /** Arm deferred tools by name so their full schema is sent on subsequent turns.
   *  Provided by the loop; `tool_search` calls it for the deferred tools it surfaces. */
  armTools?: (names: string[]) => void
}

/** Result returned by a tool run. */
export interface ToolResult {
  content: string | ContentBlockParam[]
  isError?: boolean
}

/** A tool pairs an OpenAI-shape function definition with its implementation. */
export interface Tool {
  def: ToolDef
  /** Server-side executor. OMIT to make the tool client-delegated (Vercel-style
   *  "no execute = client"): the loop emits a client_tool_request instead of
   *  running it, and the host supplies the result. */
  run?(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>
  /**
   * Max result size in characters before the agent loop spills the full output
   * to a file and replaces it with a preview + path (see large-output handling).
   * Set to `Infinity` to opt out (e.g. read_file, which is already self-bounded).
   * When omitted, the loop uses its global default threshold.
   */
  maxResultChars?: number
  /**
   * DEFER this tool out of the per-turn payload sent to the LLM. It stays
   * discoverable via `tool_search` and executable when called, but its schema
   * isn't sent (saving tokens every turn) until `tool_search` surfaces it — at
   * which point the loop "arms" it for subsequent turns. Use for large pools of
   * rarely-used integration tools. (Also settable via `query({ deferredTools })`.)
   */
  defer?: boolean
}
