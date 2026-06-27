// Public entry point — mirrors @anthropic-ai/claude-agent-sdk's query().
//
// Returns an AsyncGenerator<SDKMessage>. Accepts either a single string prompt
// or an async iterable of SDKUserMessage (for multi-turn / interactive use).

import type {
  AgentDefinition,
  CanUseTool,
  HookCallback,
  HookEvent,
  LLMClient,
  PermissionMode,
  SDKMessage,
  SDKUserMessage,
} from './types/index.js'
import type { FileReadLimits, Tool } from './tools/types.js'
import type { McpServers, McpProxy } from './mcp/index.js'
import type { SlashCommand } from './commands/index.js'
import type { SessionStoreLike } from './session/index.js'
import type { MemoryStore } from './memory/index.js'
import { runAgent, type Workspace } from './agent.js'
import { track, telemetryEnabled, tokenBucket, type TelemetryOptions } from './telemetry.js'
import { profileForModel } from './llm/profiles.js'

export interface QueryOptions {
  /** A plain string (single turn) or a stream of user messages (multi-turn). */
  prompt: string | AsyncIterable<SDKUserMessage>
  /** Workspace implementing FileSystem + CommandExecutor (e.g. WebContainerWorkspace). */
  workspace: Workspace
  /** Any OpenAI/Anthropic-compatible LLM client. */
  llm: LLMClient
  /** Tools available to the agent. REPLACES the builtins. Defaults to ALL_CLAUDE_CODE_TOOLS. */
  tools?: Tool[]
  /** Custom tools ADDED to the builtins (use `defineTool`). Filtered by allowed/disallowedTools. */
  extraTools?: Tool[]
  model?: string
  systemPrompt?: string
  appendSystemPrompt?: string
  allowedTools?: string[]
  disallowedTools?: string[]
  /** Tool names to defer out of the per-turn payload — discoverable via `tool_search`
   *  and armed on demand. Saves tokens on large tool pools (also per-tool `defer: true`). */
  deferredTools?: string[]
  maxTurns?: number
  /** Wall-clock budget (ms): pause at a turn boundary past this + emit `paused` (survivor). */
  maxDurationMs?: number
  /** Resume + continue the tool loop with no new user message (after a `paused` boundary). */
  continueRun?: boolean
  /** Tool names the HOST/client executes (e.g. bash on a browser WebContainer). The agent
   *  emits a `client_tool_request` + pauses; the client runs it and resumes with results. */
  clientTools?: string[]
  /** One switch: delegate ALL built-in workspace tools (bash + file ops) to the host
   *  so the server never runs them against its in-memory workspace — execution happens
   *  client-side (pair with anyclaude-react `createWorkspaceClientTools`). */
  clientWorkspaceTools?: boolean
  /** Results for client-tool calls, injected before continuing (with continueRun). */
  clientToolResults?: Array<{ tool_use_id: string; content: string | import('./types/index.js').ContentBlockParam[]; is_error?: boolean }>
  cwd?: string
  sessionId?: string
  abortController?: AbortController
  /** Permission gate invoked before each tool call. */
  canUseTool?: CanUseTool
  permissionMode?: PermissionMode
  /** Lifecycle hooks keyed by event. */
  hooks?: Partial<Record<HookEvent, HookCallback[]>>
  /** File-read tuning passed to tools. */
  limits?: Partial<FileReadLimits>
  /** Custom sub-agents invokable via the `task` tool, keyed by type name. */
  agents?: Record<string, AgentDefinition>
  /** Max sub-agent nesting depth. Default 2. */
  maxSubagentDepth?: number
  /** External MCP servers (HTTP/SSE) or in-process SDK servers. */
  mcpServers?: McpServers
  /** Route remote MCP requests through a proxy (works around browser CORS). */
  mcpProxy?: McpProxy
  /** Custom slash commands (merged with built-ins like /help, /compact). */
  commands?: SlashCommand[]
  /** Enable background tasks (task_list/task_output/task_stop + task run_in_background). */
  background?: boolean
  /** Inject a shared BackgroundTaskManager so background tasks persist across turns. */
  backgroundManager?: import('./background/index.js').BackgroundTaskManager
  /** Queue for interjecting user messages into the live loop (delivered one per turn boundary). */
  messageQueue?: import('./queue.js').MessageQueue
  /** Emit `stream_event` partial-assistant messages (text deltas) as they arrive. */
  includePartialMessages?: boolean
  /** Enable teammate coordination (shared mailbox + task board + team tools + coordinator prompt). */
  team?: boolean
  /** Inject a shared Mailbox so team messaging persists across turns. */
  mailbox?: import('./team/index.js').Mailbox
  /** Inject a shared TaskBoard so the task board persists across turns. */
  board?: import('./team/index.js').TaskBoard
  /** This agent's name/label for messaging (default 'coordinator'). */
  agentName?: string
  /** Persist the transcript to this store (keyed by sessionId) for resume. */
  sessionStore?: SessionStoreLike
  /** Load the stored transcript for sessionId before the first turn. */
  resume?: boolean
  /** Auto-compact the transcript when it nears the context limit. */
  autoCompact?: boolean
  /** Context window in tokens for auto-compaction (default: model window or 200k). */
  contextLimit?: number
  /** Fraction of the context limit that triggers compaction (default 0.8). */
  compactThreshold?: number
  /** Persistent memory store; entries load into the system prompt and are editable via memory tools. */
  memory?: MemoryStore
  /** Permission rules (allow/deny/ask rule strings) → builds a canUseTool gate. */
  permissionRules?: { allow?: string[]; deny?: string[]; ask?: string[] }
  /** Prompt callback for 'ask' permission decisions. */
  onPermissionAsk?: (toolName: string, input: Record<string, unknown>) => Promise<boolean>
  /** Handler for the `ask_user_question` tool. When set, the tool is registered. */
  onAskUser?: (q: {
    question: string
    header?: string
    options: Array<{ label: string; description?: string }>
    multiSelect?: boolean
  }) => Promise<string | string[]>
  /** Load `.claude/settings.json` (project/local cascade), or pass a Settings object. */
  settings?: boolean | import('./settings/index.js').Settings
  /** Load `.claude/skills/*.md` as slash commands + a skill registry, or pass a Skill[]. */
  skills?: boolean | import('./skills/index.js').Skill[]
  /** Anonymous, opt-out usage telemetry (version/runtime/which-features only — never
   *  code, prompts, repo, or keys). Configure or disable via `telemetry`; see TELEMETRY.md. */
  telemetry?: TelemetryOptions
  /** Convenience to force telemetry off for this run (same as `telemetry: { disabled: true }`). */
  disableTelemetry?: boolean
}

/** An async iterator of SDK messages, augmented with session controls. */
export interface Query extends AsyncGenerator<SDKMessage, void, void> {
  /** Abort the in-flight run (stops the LLM stream and pending tools). */
  interrupt(): void
}

export function query(options: QueryOptions): Query {
  const prompt =
    typeof options.prompt === 'string'
      ? singlePrompt(options.prompt)
      : options.prompt

  const abortController = options.abortController ?? new AbortController()

  const gen = runAgent({
    prompt,
    workspace: options.workspace,
    llm: options.llm,
    tools: options.tools,
    extraTools: options.extraTools,
    model: options.model,
    systemPrompt: options.systemPrompt,
    appendSystemPrompt: options.appendSystemPrompt,
    allowedTools: options.allowedTools,
    disallowedTools: options.disallowedTools,
    deferredTools: options.deferredTools,
    maxTurns: options.maxTurns,
    maxDurationMs: options.maxDurationMs,
    continueRun: options.continueRun,
    clientTools: options.clientTools,
    clientWorkspaceTools: options.clientWorkspaceTools,
    clientToolResults: options.clientToolResults,
    cwd: options.cwd,
    sessionId: options.sessionId,
    abortController,
    canUseTool: options.canUseTool,
    permissionMode: options.permissionMode,
    hooks: options.hooks,
    limits: options.limits,
    agents: options.agents,
    maxSubagentDepth: options.maxSubagentDepth,
    mcpServers: options.mcpServers,
    mcpProxy: options.mcpProxy,
    commands: options.commands,
    background: options.background,
    backgroundManager: options.backgroundManager,
    messageQueue: options.messageQueue,
    includePartialMessages: options.includePartialMessages,
    team: options.team,
    mailbox: options.mailbox,
    board: options.board,
    agentName: options.agentName,
    sessionStore: options.sessionStore,
    resume: options.resume,
    autoCompact: options.autoCompact,
    contextLimit: options.contextLimit,
    compactThreshold: options.compactThreshold,
    memory: options.memory,
    permissionRules: options.permissionRules,
    onPermissionAsk: options.onPermissionAsk,
    onAskUser: options.onAskUser,
    settings: options.settings,
    skills: options.skills,
  }) as Query

  // Anonymous, aggregate adoption signal. Fire-and-forget, never blocks, no-ops
  // unless enabled + a collector is configured. Only booleans + coarse buckets
  // (model family, token-volume bucket) ever leave the process — see telemetry.ts.
  const telemetry: TelemetryOptions = {
    disabled: options.disableTelemetry,
    ...options.telemetry,
  }
  const modelFamily = profileForModel(options.model).name
  const enabled = telemetryEnabled(telemetry)

  if (enabled) {
    track(
      'run',
      {
        model_family: modelFamily,
        client_workspace_tools: !!options.clientWorkspaceTools,
        client_tools: !!options.clientTools?.length,
        survivor: options.maxDurationMs != null,
        mcp: !!options.mcpServers,
        team: !!options.team,
        background: !!options.background,
        auto_compact: !!options.autoCompact,
        skills: !!options.skills,
        sessions: !!options.sessionStore,
        partial_messages: !!options.includePartialMessages,
        resumed: !!options.continueRun || !!options.resume,
      },
      telemetry
    )
  }

  if (!enabled) {
    gen.interrupt = () => abortController.abort()
    return gen
  }

  // Wrap to emit one `run_end` with a coarse token-volume bucket when the run
  // finishes (tokens aren't known until the `result` message). Pass-through only.
  const wrapped = (async function* () {
    let totalTokens = 0
    try {
      for await (const m of gen) {
        if (m.type === 'result' && (m as { usage?: { input_tokens?: number; output_tokens?: number } }).usage) {
          const u = (m as { usage: { input_tokens?: number; output_tokens?: number } }).usage
          totalTokens = (u.input_tokens || 0) + (u.output_tokens || 0)
        }
        yield m
      }
    } finally {
      track('run_end', { model_family: modelFamily, tokens_bucket: tokenBucket(totalTokens) }, telemetry)
    }
  })() as Query
  wrapped.interrupt = () => abortController.abort()
  return wrapped
}

/** Wrap a single text prompt into the async-iterable form runAgent expects. */
export async function* singlePrompt(text: string): AsyncIterable<SDKUserMessage> {
  yield {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
    timestamp: new Date().toISOString(),
  }
}

/**
 * A simple push-based prompt queue for interactive sessions. Feed user turns
 * with `.push(text)` and end the conversation with `.end()`.
 */
export class PromptStream implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = []
  private resolvers: Array<(v: IteratorResult<SDKUserMessage>) => void> = []
  private done = false

  push(content: string | SDKUserMessage['message']['content']): void {
    const message: SDKUserMessage = {
      type: 'user',
      message: {
        role: 'user',
        content: typeof content === 'string' ? content : content,
      },
      parent_tool_use_id: null,
      timestamp: new Date().toISOString(),
    }
    const r = this.resolvers.shift()
    if (r) r({ value: message, done: false })
    else this.queue.push(message)
  }

  end(): void {
    this.done = true
    let r = this.resolvers.shift()
    while (r) {
      r({ value: undefined as unknown as SDKUserMessage, done: true })
      r = this.resolvers.shift()
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: (): Promise<IteratorResult<SDKUserMessage>> => {
        const queued = this.queue.shift()
        if (queued) return Promise.resolve({ value: queued, done: false })
        if (this.done)
          return Promise.resolve({
            value: undefined as unknown as SDKUserMessage,
            done: true,
          })
        return new Promise((resolve) => this.resolvers.push(resolve))
      },
    }
  }
}
