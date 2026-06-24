// Agent loop engine — the multi-turn tool loop that powers query().
//
// Mirrors the Claude Code QueryEngine pattern:
//   1. Accumulate messages
//   2. Call the LLM with tools
//   3. Extract tool calls from the response
//   4. Run permission gate + PreToolUse hooks
//   5. Execute each tool against the workspace
//   6. Run PostToolUse hooks; append results to the message history
//   7. Repeat until no tool calls or max turns reached

import type {
  AgentDefinition,
  AgentStore,
  APIAssistantMessage,
  CanUseTool,
  ChatMsg,
  CommandExecutor,
  ContentBlockParam,
  FileSystem,
  HookCallback,
  HookEvent,
  HookInput,
  HookOutput,
  ImageBlock,
  ModelUsage,
  PermissionMode,
  PermissionResult,
  SDKMessage,
  SDKPermissionDenial,
  SDKUserMessage,
  StopReason,
  TextBlock,
  ToolCall,
  ToolUseBlock,
  Usage,
} from './types/index.js'
import type { FileReadLimits, Tool, ToolContext } from './tools/types.js'
import { ALL_CLAUDE_CODE_TOOLS, toolByName, toolDefs } from './tools/index.js'
import { task as taskTool } from './tools/task.js'
import { loadMcpServers, type McpServers, type McpProxy } from './mcp/index.js'
import { runSlashCommand } from './commands/index.js'
import type { SlashCommand } from './commands/index.js'
import { BackgroundTaskManager, BACKGROUND_TOOLS } from './background/index.js'
import { Mailbox, TaskBoard, TEAM_TOOLS, TEAM_DISPATCH_TOOLS, coordinatorPrompt } from './team/index.js'
import { MEMORY_TOOLS } from './memory/index.js'
import type { MemoryStore } from './memory/index.js'
import type { SessionStoreLike } from './session/index.js'
import { PLAN_MODE_TOOLS } from './tools/plan_mode.js'
import {
  rulesToCanUseTool,
  ruleSetFromStrings,
  applyPermissionUpdate,
  isReadOnlyTool,
  type PermissionRuleSet,
} from './permissions/index.js'
import { loadSettings, mergeSettings, settingsToPermissionRuleSet, type Settings } from './settings/index.js'
import { loadSkillsFromFs, skillsToCommands, skill as skillTool, type Skill } from './skills/index.js'
import { defaultSystemPrompt, defaultSubagentPrompt } from './prompt.js'
import { DEFAULT_MAX_RESULT_CHARS, maybePersistLargeResult } from './persist.js'
import { computeCostUSD, contextWindowFor } from './util/pricing.js'
import { estimateTokens, summarizeHistory } from './compact.js'
import { uuid } from './util/ids.js'

/** Wrap a single text prompt into the async-iterable form runAgent expects. */
async function* singleUserPrompt(text: string): AsyncIterable<SDKUserMessage> {
  yield {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
    timestamp: new Date().toISOString(),
  }
}

export type Workspace = FileSystem & CommandExecutor

/** File-mutating tools whose success fires a FileChanged hook. */
const MUTATING_FILE_TOOLS = new Set([
  'write_file',
  'edit_file',
  'multi_edit',
  'delete_file',
  'notebook_edit',
])

export interface AgentOptions {
  prompt: AsyncIterable<SDKUserMessage>
  workspace: Workspace
  llm: LLMClientLike
  /** Full tool set — REPLACES the builtins. Omit to keep the defaults. */
  tools?: Tool[]
  /** Custom tools ADDED to the builtins (or to `tools` if given). Use `defineTool`. */
  extraTools?: Tool[]
  model?: string
  /** Full system prompt. If omitted, the default Claude Code prompt is used. */
  systemPrompt?: string
  /** Text appended after the (default or custom) system prompt. */
  appendSystemPrompt?: string
  /** Allowlist of tool names. When set, only these tools are exposed. */
  allowedTools?: string[]
  /** Denylist of tool names, applied after allowedTools. */
  disallowedTools?: string[]
  maxTurns?: number
  /** Wall-clock budget (ms). At a turn boundary past this, the loop pauses: it
   *  persists to sessionStore and emits a `paused` system message instead of
   *  continuing — for spanning serverless function time limits ("survivor"). */
  maxDurationMs?: number
  /** Resume + CONTINUE the tool loop on the stored transcript without a new user
   *  message (pairs with `resume`). Used to continue after a `paused` boundary. */
  continueRun?: boolean
  cwd?: string
  sessionId?: string
  abortController?: AbortController
  /** Permission gate invoked before each tool call. */
  canUseTool?: CanUseTool
  permissionMode?: PermissionMode
  /** Lifecycle hooks keyed by event. */
  hooks?: Partial<Record<HookEvent, HookCallback[]>>
  /** File-read tuning passed through to tools. */
  limits?: Partial<FileReadLimits>
  /**
   * Spill oversized tool results to a file and hand the model a preview + path
   * instead of the full text (keeps huge outputs out of context). Default: true.
   */
  persistLargeResults?: boolean
  /** Char threshold before a tool result spills to disk. Default 50,000. */
  maxToolResultChars?: number
  /**
   * Custom sub-agents invokable via the `task` tool, keyed by agent type name.
   * When provided, the `task` tool is auto-registered.
   */
  agents?: Record<string, AgentDefinition>
  /** Internal: current sub-agent nesting depth. */
  subagentDepth?: number
  /** Max sub-agent nesting depth (prevents runaway recursion). Default 2. */
  maxSubagentDepth?: number
  /** External MCP servers (HTTP/SSE) or in-process SDK servers to load tools from. */
  mcpServers?: McpServers
  /** Route remote MCP requests through a proxy (works around browser CORS). */
  mcpProxy?: McpProxy
  /** Custom slash commands (merged with built-ins like /help, /compact). */
  commands?: SlashCommand[]
  /** Enable background tasks (task_list/task_output/task_stop + task run_in_background). */
  background?: boolean
  /** Inject a shared BackgroundTaskManager so tasks persist across turns. */
  backgroundManager?: BackgroundTaskManager
  /** Queue for interjecting user messages into the live loop (delivered one per turn boundary). */
  messageQueue?: import('./queue.js').MessageQueue
  /** Emit `stream_event` partial-assistant messages (text deltas) as they arrive. */
  includePartialMessages?: boolean
  /** Enable teammate coordination: shared mailbox + task board, team tools, coordinator prompt. */
  team?: boolean
  /** Internal: shared Mailbox passed down to sub-agents (set automatically). */
  mailbox?: Mailbox
  /** Internal: shared TaskBoard passed down to sub-agents (set automatically). */
  board?: TaskBoard
  /** This agent's name/label for messaging (default 'coordinator'). */
  agentName?: string
  /** Persist the transcript to this store (keyed by sessionId) for resume. */
  sessionStore?: SessionStoreLike
  /** Load the stored transcript for sessionId before the first turn. */
  resume?: boolean
  /** Auto-compact the transcript when it approaches the context limit. */
  autoCompact?: boolean
  /** Context window in tokens for auto-compaction. Default: model's window or 200k. */
  contextLimit?: number
  /** Fraction of the context limit that triggers compaction. Default 0.8. */
  compactThreshold?: number
  /** Persistent memory store; entries are loaded into the system prompt and editable via memory tools. */
  memory?: MemoryStore
  /** Permission rules (allow/deny/ask rule strings); builds a canUseTool gate. */
  permissionRules?: { allow?: string[]; deny?: string[]; ask?: string[] }
  /** Prompt callback for 'ask' decisions; if absent, default mode allows / dontAsk denies. */
  onPermissionAsk?: (toolName: string, input: Record<string, unknown>) => Promise<boolean>
  /** Load + apply `.claude/settings.json` (project/local cascade) under explicit options. true, or a Settings object. */
  settings?: boolean | Settings
  /** Load `.claude/skills/*.md` as slash commands + skill registry. true, or a Skill[] array. */
  skills?: boolean | Skill[]
}

/** A minimal pushable async queue: yields pushed items until closed. */
function createPushQueue<T>() {
  const items: T[] = []
  let resolveNext: ((r: IteratorResult<T>) => void) | null = null
  let closed = false
  return {
    push(v: T) {
      if (resolveNext) {
        resolveNext({ value: v, done: false })
        resolveNext = null
      } else items.push(v)
    },
    close() {
      closed = true
      if (resolveNext) {
        resolveNext({ value: undefined as unknown as T, done: true })
        resolveNext = null
      }
    },
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next: (): Promise<IteratorResult<T>> => {
          if (items.length) return Promise.resolve({ value: items.shift() as T, done: false })
          if (closed) return Promise.resolve({ value: undefined as unknown as T, done: true })
          return new Promise((res) => (resolveNext = res))
        },
      }
    },
  }
}

// Structural type so agent.ts doesn't import the full LLMClient (avoids cycle churn).
type LLMClientLike = import('./types/index.js').LLMClient

const emptyUsage = (): Usage => ({ input_tokens: 0, output_tokens: 0 })

function addUsageInto(target: Usage, b?: Usage): void {
  if (!b) return
  target.input_tokens += b.input_tokens || 0
  target.output_tokens += b.output_tokens || 0
  target.cache_read_input_tokens =
    (target.cache_read_input_tokens || 0) + (b.cache_read_input_tokens || 0)
  target.cache_creation_input_tokens =
    (target.cache_creation_input_tokens || 0) + (b.cache_creation_input_tokens || 0)
}

function toolUseBlocks(calls: ToolCall[]): ToolUseBlock[] {
  return calls.map((c) => ({
    type: 'tool_use',
    id: c.id,
    name: c.function.name,
    input: safeParse(c.function.arguments),
  }))
}

function safeParse(json: string): Record<string, unknown> {
  if (!json || !json.trim()) return {}
  try {
    const v = JSON.parse(json)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : { value: v }
  } catch {
    return { _raw: json }
  }
}

function resultToText(content: string | ContentBlockParam[]): string {
  if (typeof content === 'string') return content
  return content
    .map((b) => {
      if (b.type === 'text') return b.text
      if (b.type === 'image') return '[image]'
      if (b.type === 'document') return `[document${b.title ? ': ' + b.title : ''}]`
      return `[${b.type}]`
    })
    .join('\n')
}

/** Keep only text/image/document blocks for a tool_result payload. */
function toToolResultContent(
  content: string | ContentBlockParam[]
): string | Array<TextBlock | ImageBlock | import('./types/index.js').DocumentBlock> {
  if (typeof content === 'string') return content
  return content.filter(
    (b) => b.type === 'text' || b.type === 'image' || b.type === 'document'
  ) as Array<TextBlock | ImageBlock | import('./types/index.js').DocumentBlock>
}

function selectTools(
  tools: Tool[],
  allow?: string[],
  deny?: string[]
): Tool[] {
  let out = tools
  if (allow?.length) out = out.filter((t) => allow.includes(t.def.function.name))
  if (deny?.length) out = out.filter((t) => !deny.includes(t.def.function.name))
  return out
}

/**
 * The core agent loop. Yields faithful SDKMessages as the conversation
 * progresses: an init system message, assistant turns, synthetic user turns
 * carrying tool_results, and a final result message per user prompt.
 */
export async function* runAgent(options: AgentOptions): AsyncGenerator<SDKMessage> {
  const {
    prompt,
    workspace,
    llm,
    abortController,
    hooks,
    limits,
  } = options

  // Prefer the workspace's own cwd (e.g. LocalSandbox/WebContainer) so the
  // system prompt and tool path resolution match the real filesystem root.
  const workspaceCwd = (workspace as { cwd?: string }).cwd
  const cwd = options.cwd ?? workspaceCwd ?? '/home/projects'
  const sessionId = options.sessionId ?? uuid()
  const signal = abortController?.signal

  // Load .claude/settings.json (project/local cascade) when requested; explicit
  // options always win over settings.
  let settings: Settings = {}
  if (options.settings === true) settings = await loadSettings(workspace, { cwd })
  else if (options.settings && typeof options.settings === 'object') settings = options.settings

  const model = options.model ?? settings.model
  const maxTurns = options.maxTurns ?? settings.maxTurns ?? 50
  const permissionMode: PermissionMode =
    options.permissionMode ?? settings.permissionMode ?? 'bypassPermissions'
  const persistLargeResults = options.persistLargeResults !== false
  const maxToolResultChars = options.maxToolResultChars ?? DEFAULT_MAX_RESULT_CHARS
  const emitPartial = options.includePartialMessages === true

  // `tools` replaces the builtin set; `extraTools` is ADDED to it (so custom
  // tools augment the defaults). Then allow/deny filtering narrows the result.
  const baseTools = selectTools(
    [...(options.tools ?? ALL_CLAUDE_CODE_TOOLS), ...(options.extraTools ?? [])],
    options.allowedTools ?? settings.allowedTools,
    options.disallowedTools ?? settings.disallowedTools
  )

  // Skills: load .claude/skills/*.md (or use a provided array) → slash commands + registry.
  let skills: Skill[] = []
  if (options.skills === true) skills = await loadSkillsFromFs(workspace)
  else if (Array.isArray(options.skills)) skills = options.skills

  // Permission gate: explicit canUseTool wins; else build one from rules
  // (options.permissionRules merged with settings rules).
  const settingsRules = settingsToPermissionRuleSet(settings)
  const ruleSet: PermissionRuleSet = ruleSetFromStrings({
    allow: [...(options.permissionRules?.allow ?? []), ...settingsRules.allow],
    deny: [...(options.permissionRules?.deny ?? []), ...settingsRules.deny],
    ask: [...(options.permissionRules?.ask ?? []), ...settingsRules.ask],
  })
  const hasRules = ruleSet.allow.length + ruleSet.deny.length + ruleSet.ask.length > 0
  const ruleBased = !options.canUseTool && hasRules
  let activeRuleSet = ruleSet
  const buildGate = () =>
    rulesToCanUseTool(activeRuleSet, {
      mode: permissionMode,
      onAsk: options.onPermissionAsk,
      flagDangerous: true,
    })
  let canUseTool = options.canUseTool ?? (hasRules ? buildGate() : undefined)

  const planMode = { active: permissionMode === 'plan' }

  // Sub-agents: register the `task` tool when agents are configured and we have
  // nesting budget left (prevents runaway recursion).
  const agents = options.agents
  const depth = options.subagentDepth ?? 0
  const maxDepth = options.maxSubagentDepth ?? 2
  const subagentsEnabled = !!agents && depth < maxDepth
  // Background tasks: a manager + the management tools, when enabled.
  // A background manager may be injected so tasks persist across turns (the TUI
  // shares one for the whole session); otherwise one is created when enabled.
  const backgroundEnabled = options.background === true || !!options.backgroundManager
  const background = backgroundEnabled
    ? options.backgroundManager ?? new BackgroundTaskManager()
    : undefined
  const messageQueue = options.messageQueue

  // Teammates: a shared Mailbox + TaskBoard (reused from the parent when this
  // is a sub-agent) + team tools + coordinator prompt.
  const teamEnabled = options.team === true
  const mailbox = teamEnabled ? options.mailbox ?? new Mailbox() : undefined
  const board = teamEnabled ? options.board ?? new TaskBoard() : undefined
  const agentName = options.agentName ?? 'coordinator'

  let localTools =
    subagentsEnabled && !baseTools.some((t) => t.def.function.name === 'task')
      ? [...baseTools, taskTool]
      : baseTools
  if (backgroundEnabled) {
    const present = new Set(localTools.map((t) => t.def.function.name))
    localTools = [...localTools, ...BACKGROUND_TOOLS.filter((t) => !present.has(t.def.function.name))]
  }
  if (teamEnabled) {
    const present = new Set(localTools.map((t) => t.def.function.name))
    const teamSet = subagentsEnabled ? [...TEAM_TOOLS, ...TEAM_DISPATCH_TOOLS] : TEAM_TOOLS
    localTools = [...localTools, ...teamSet.filter((t) => !present.has(t.def.function.name))]
  }
  const memory = options.memory
  if (memory) {
    const present = new Set(localTools.map((t) => t.def.function.name))
    localTools = [...localTools, ...MEMORY_TOOLS.filter((t) => !present.has(t.def.function.name))]
  }
  // Skill tool (when skills are available) + plan-mode tools (always, so the
  // agent can enter/exit plan mode on demand).
  {
    const present = new Set(localTools.map((t) => t.def.function.name))
    const extra: Tool[] = [...PLAN_MODE_TOOLS]
    if (skills.length) extra.push(skillTool)
    localTools = [...localTools, ...extra.filter((t) => !present.has(t.def.function.name))]
  }

  // Load MCP server tools (HTTP/SSE/in-process) and merge them in. Never throws;
  // failed servers contribute no tools and surface in mcp_servers status.
  let mcpStatuses: Array<{ name: string; status: string }> = []
  let tools = localTools
  if (options.mcpServers && Object.keys(options.mcpServers).length) {
    const loaded = await loadMcpServers(options.mcpServers, {
      signal,
      proxy: options.mcpProxy,
    })
    tools = [...localTools, ...loaded.tools]
    mcpStatuses = loaded.statuses.map((s) => ({ name: s.name, status: s.status }))
  }

  const defs = toolDefs(tools)
  const byName = toolByName(tools)

  let system =
    options.systemPrompt != null ? options.systemPrompt : defaultSystemPrompt(cwd)
  if (teamEnabled) system += '\n\n' + coordinatorPrompt()
  if (memory) {
    const mem = await memory.render()
    if (mem) system += '\n\n' + mem
  }
  if (options.appendSystemPrompt) system += '\n\n' + options.appendSystemPrompt

  const history: ChatMsg[] = [{ role: 'system', content: system }]

  const store: AgentStore = { todos: [] }
  const ctx: ToolContext = {
    fs: workspace,
    exec: workspace,
    cwd,
    readFiles: new Set<string>(),
    signal,
    store,
    limits,
    background,
    mailbox,
    board,
    agentName,
    toolIndex: defs.map((d) => ({ name: d.function.name, description: d.function.description })),
    memory,
    skills,
    planMode,
  }

  const skillCommands = skillsToCommands(skills)
  const allCommands = [...(options.commands ?? []), ...skillCommands]

  // Wire sub-agent spawning. Each call runs a fresh, isolated runAgent to
  // completion and returns only its final text.
  if (subagentsEnabled) {
    ctx.runSubagent = async ({ prompt: subPrompt, agentType, signal: subSignal, onProgress }) => {
      const def = agentType ? agents?.[agentType] : undefined
      const subSystem = def?.prompt ?? defaultSubagentPrompt(cwd)
      const subTools = def?.tools
        ? baseTools.filter((t) => def.tools!.includes(t.def.function.name))
        : baseTools
      await runHooks('SubagentStart', {
        hook_event_name: 'SubagentStart',
        agent_type: agentType || 'general-purpose',
      })
      let finalText = ''
      let isError = false
      // Own controller so the caller's signal (e.g. a background task's stop)
      // AND the parent's abort both cancel this sub-agent.
      const childController = new AbortController()
      const onAbort = () => childController.abort()
      abortController?.signal.addEventListener('abort', onAbort)
      subSignal?.addEventListener('abort', onAbort)
      if (abortController?.signal.aborted || subSignal?.aborted) childController.abort()
      const child = runAgent({
        prompt: singleUserPrompt(subPrompt),
        workspace,
        llm,
        tools: subTools,
        model: def?.model ?? model,
        systemPrompt: subSystem,
        maxTurns,
        cwd,
        abortController: childController,
        canUseTool,
        permissionMode,
        hooks,
        limits,
        persistLargeResults,
        maxToolResultChars,
        agents,
        subagentDepth: depth + 1,
        maxSubagentDepth: maxDepth,
        // Share the same mailbox + board so workers and the coordinator
        // collaborate on one set of tasks/messages.
        team: teamEnabled,
        mailbox,
        board,
        agentName: agentType || 'worker',
        memory,
        skills,
      })
      for await (const m of child) {
        if (m.type === 'assistant') {
          const t = m.message.content
            .filter((b): b is TextBlock => b.type === 'text')
            .map((b) => b.text)
            .join('\n')
          if (t) {
            finalText = t
            onProgress?.(t)
          }
          for (const b of m.message.content) {
            if (b.type === 'tool_use') onProgress?.(`[${b.name}]`)
          }
        } else if (m.type === 'result') {
          if (m.subtype !== 'success') isError = true
          if ('result' in m && m.result) finalText = m.result
        }
      }
      abortController?.signal.removeEventListener('abort', onAbort)
      subSignal?.removeEventListener('abort', onAbort)
      await runHooks('SubagentStop', {
        hook_event_name: 'SubagentStop',
        agent_type: agentType || 'general-purpose',
        last_assistant_message: finalText,
      })
      return { text: finalText, isError }
    }
  }

  async function runHooks(event: HookEvent, input: HookInput): Promise<HookOutput[]> {
    const cbs = hooks?.[event]
    if (!cbs?.length) return []
    const out: HookOutput[] = []
    for (const cb of cbs) {
      try {
        out.push(await cb(input, { signal }))
      } catch (err) {
        out.push({
          systemMessage: `Hook ${event} error: ${
            err instanceof Error ? err.message : String(err)
          }`,
        })
      }
    }
    return out
  }

  // Init system message.
  yield {
    type: 'system',
    subtype: 'init',
    apiKeySource: 'none',
    cwd,
    tools: defs.map((d) => d.function.name),
    mcp_servers: mcpStatuses,
    model: model ?? 'unknown',
    permissionMode,
    slash_commands: [],
    output_style: 'default',
    skills: [],
    agents: agents ? Object.keys(agents) : undefined,
    uuid: uuid(),
    session_id: sessionId,
  }

  await runHooks('SessionStart', {
    hook_event_name: 'SessionStart',
    source: agentName === 'coordinator' ? 'startup' : 'subagent',
    cwd,
    model: model ?? 'unknown',
  })

  const startedAt = Date.now()
  const sessionUsage = emptyUsage()
  const maxDurationMs = options.maxDurationMs
  let paused = false

  // Resume: seed the transcript from a prior session before the first turn.
  if (options.resume && options.sessionStore) {
    const prior = await options.sessionStore.load(sessionId)
    if (prior && prior.length) {
      // Replace everything after our system message with the stored transcript
      // (which already includes its own system message at index 0).
      history.splice(0, history.length, ...prior)
    }
  }

  // continueRun: prepend a sentinel turn so the loop continues the stored
  // transcript with no new user message (used after a `paused` boundary).
  const promptSrc = options.continueRun ? withContinueSentinel(prompt) : prompt

  for await (const userMsg of promptSrc) {
    if (signal?.aborted) break

    const isContinue = (userMsg as { __continue?: boolean }).__continue === true
    const content = userMsg.message.content

    // Slash-command interception: a string user turn beginning with '/'.
    if (!isContinue && typeof content === 'string' && content.trim().startsWith('/')) {
      const outcome = await runSlashCommand(content, {
        history,
        tools: defs.map((d) => ({
          name: d.function.name,
          description: d.function.description,
        })),
        model,
        cwd,
        usage: sessionUsage,
        store,
        signal,
        llm,
        commands: allCommands,
        sessionId,
        sessionStore: options.sessionStore,
        readFiles: ctx.readFiles,
        agents,
        mcpServers: mcpStatuses,
        permissionMode,
        background,
        board,
        exec: (command) => workspace.exec(command),
        fs: { readFile: (p) => workspace.readFile(p) },
        memory,
      })
      if (outcome) {
        if (outcome.compacted) {
          await runHooks('PreCompact', { hook_event_name: 'PreCompact', trigger: 'manual' })
        }
        if (outcome.newHistory) history.splice(0, history.length, ...outcome.newHistory)
        if (outcome.compacted) {
          yield {
            type: 'system',
            subtype: 'compact_boundary',
            compact_metadata: { trigger: 'manual', pre_tokens: 0 },
            uuid: uuid(),
            session_id: sessionId,
          }
          await runHooks('PostCompact', { hook_event_name: 'PostCompact', trigger: 'manual' })
        }
        if (outcome.systemText) {
          yield {
            type: 'system',
            subtype: 'local_command_output',
            content: outcome.systemText,
            uuid: uuid(),
            session_id: sessionId,
          }
        }
        if (outcome.expandedPrompt != null) {
          history.push({ role: 'user', content: outcome.expandedPrompt })
        } else {
          continue // command handled; no LLM turn
        }
      } else {
        history.push({ role: 'user', content }) // unknown command → normal prompt
      }
    } else if (!isContinue) {
      history.push({ role: 'user', content })
      const pre = await runHooks('UserPromptSubmit', {
        hook_event_name: 'UserPromptSubmit',
        prompt: typeof content === 'string' ? content : '',
      })
      const extra = pre.map((o) => (o && o.additionalContext) || '').filter(Boolean).join('\n')
      if (extra) history.push({ role: 'user', content: extra })
    }

    let turns = 0
    let lastText = ''
    let resultModel = model ?? 'unknown'
    const usageTotal = emptyUsage()
    let apiMs = 0
    let hitMaxTurns = false
    let errored: string | null = null
    const denials: SDKPermissionDenial[] = []

    let autoCompactCount = 0
    while (true) {
      if (signal?.aborted) break
      if (turns >= maxTurns) {
        hitMaxTurns = true
        break
      }
      // Survivor: pause at this turn boundary if we're past the time budget.
      if (maxDurationMs != null && Date.now() - startedAt >= maxDurationMs) {
        paused = true
        break
      }
      turns++

      // Message queue: deliver one interjected user message per turn boundary.
      // (Messages enqueued via options.messageQueue while this loop runs.)
      if (messageQueue && messageQueue.size > 0) {
        const queued = messageQueue.shift()
        if (queued) {
          history.push({ role: 'user', content: queued.content })
          yield {
            type: 'user',
            message: { role: 'user', content: queued.content },
            parent_tool_use_id: null,
            timestamp: new Date().toISOString(),
            uuid: uuid(),
            session_id: sessionId,
          }
        }
      }

      // Auto-compaction: summarize when the transcript nears the context limit.
      // Circuit-breaker: stop after 3 compactions (avoids a summarize loop).
      if (options.autoCompact && autoCompactCount < 3 && history.length > 3) {
        const limit = options.contextLimit ?? (contextWindowFor(resultModel) || 200_000)
        const threshold = (options.compactThreshold ?? 0.8) * limit
        if (estimateTokens(history) > threshold) {
          await runHooks('PreCompact', { hook_event_name: 'PreCompact', trigger: 'auto' })
          const compacted = await summarizeHistory(history, llm, { model, signal })
          if (compacted) {
            history.splice(0, history.length, ...compacted)
            autoCompactCount++
            yield {
              type: 'system',
              subtype: 'compact_boundary',
              compact_metadata: { trigger: 'auto', pre_tokens: Math.round(threshold) },
              uuid: uuid(),
              session_id: sessionId,
            }
            await runHooks('PostCompact', { hook_event_name: 'PostCompact', trigger: 'auto' })
          }
        }
      }

      let streamedText = ''
      let captured: ToolCall[] = []
      const apiStart = Date.now()
      let result
      try {
        if (emitPartial) {
          // Stream token deltas to the consumer as stream_event messages while
          // the request is in flight, then await the final result.
          const q = createPushQueue<SDKMessage>()
          let inToolMarkup = false
          const sp = llm.streamChat(history, {
            model,
            tools: defs,
            signal,
            onToken: (delta) => {
              streamedText += delta
              // Stop streaming once inline tool-call markup begins; it would
              // otherwise flood the UI with raw XML / file contents. The cleaned
              // text arrives with the final assistant message.
              if (!inToolMarkup && /<tool_call|<function\s*=/.test(streamedText)) {
                inToolMarkup = true
              }
              if (inToolMarkup) return
              q.push({
                type: 'stream_event',
                event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: delta } },
                parent_tool_use_id: null,
                uuid: uuid(),
                session_id: sessionId,
              })
            },
            onTool: (calls) => {
              captured = calls
            },
          })
          sp.then(() => {}, () => {}).finally(() => q.close())
          for await (const ev of q) yield ev
          result = await sp
        } else {
          result = await llm.streamChat(history, {
            model,
            tools: defs,
            signal,
            onToken: (delta) => {
              streamedText += delta
            },
            onTool: (calls) => {
              captured = calls
            },
          })
        }
      } catch (err) {
        errored = err instanceof Error ? err.message : String(err)
        break
      }
      apiMs += Date.now() - apiStart

      const text = result.text || streamedText
      const calls = result.toolCalls.length ? result.toolCalls : captured
      lastText = text || lastText
      resultModel = result.model || resultModel
      addUsageInto(usageTotal, result.usage)
      addUsageInto(sessionUsage, result.usage)

      const stopReason: StopReason = calls.length
        ? 'tool_use'
        : result.stopReason ?? 'end_turn'

      const assistantContent: ContentBlockParam[] = []
      if (text) assistantContent.push({ type: 'text', text })
      assistantContent.push(...toolUseBlocks(calls))

      const apiAssistant: APIAssistantMessage = {
        id: 'msg_' + uuid().replace(/-/g, '').slice(0, 24),
        type: 'message',
        role: 'assistant',
        model: resultModel,
        content: assistantContent,
        stop_reason: stopReason,
        stop_sequence: null,
        usage: result.usage ?? emptyUsage(),
      }

      yield {
        type: 'assistant',
        message: apiAssistant,
        parent_tool_use_id: null,
        uuid: uuid(),
        session_id: sessionId,
      }

      history.push({
        role: 'assistant',
        content: text,
        tool_calls: calls.length ? calls : undefined,
      })

      // end_turn — unless the user queued more messages, in which case keep
      // going (the next iteration's boundary injects the next queued message).
      if (!calls.length) {
        if (messageQueue && messageQueue.size > 0) continue
        break
      }

      // Execute tool calls (permission gate + hooks around each).
      const toolResultBlocks: ContentBlockParam[] = []
      const turnMedia: Array<ImageBlock | import('./types/index.js').DocumentBlock> = []
      for (const call of calls) {
        if (signal?.aborted) break
        const name = call.function.name
        let input = safeParse(call.function.arguments)
        const tool = byName.get(name)

        let content: string | ContentBlockParam[] = ''
        let isError = false
        let extraContext = ''

        if (!tool) {
          content = `Error: unknown tool "${name}"`
          isError = true
        } else {
          // PreToolUse hooks (may block or inject context).
          const pre = await runHooks('PreToolUse', {
            hook_event_name: 'PreToolUse',
            tool_name: name,
            tool_input: input,
            tool_use_id: call.id,
          })
          const blocked = pre.find(
            (o) =>
              o &&
              (o.decision === 'block' ||
                o.permissionDecision === 'deny' ||
                o.permissionDecision === 'ask')
          )
          extraContext += pre
            .map((o) => (o && o.additionalContext) || '')
            .filter(Boolean)
            .join('\n')

          // Plan mode: block mutating tools until the agent exits plan mode.
          const planBlocked =
            planMode.active &&
            name !== 'enter_plan_mode' &&
            name !== 'exit_plan_mode' &&
            !isReadOnlyTool(name, input)

          const denyTool = async (reason: string) => {
            denials.push({ tool_name: name, tool_use_id: call.id, tool_input: input })
            content = `Permission denied: ${reason}`
            isError = true
            await runHooks('PermissionDenied', {
              hook_event_name: 'PermissionDenied',
              tool_name: name,
              tool_input: input,
              tool_use_id: call.id,
              reason,
            })
          }

          if (blocked) {
            await denyTool(blocked.permissionDecisionReason || 'Blocked by PreToolUse hook')
          } else if (planBlocked) {
            await denyTool(
              `Plan mode is active — "${name}" is a mutating tool and is blocked. Investigate with read-only tools, then call exit_plan_mode before making changes.`
            )
          } else {
            // PermissionRequest hooks fire before the gate; they can decide the
            // call outright and/or suggest permission rule updates.
            const preq = await runHooks('PermissionRequest', {
              hook_event_name: 'PermissionRequest',
              tool_name: name,
              tool_input: input,
              tool_use_id: call.id,
            })
            let preApproved = false
            let preDenied: string | undefined
            for (const o of preq) {
              if (!o) continue
              if (o.permissionUpdates?.length && ruleBased) {
                for (const u of o.permissionUpdates) activeRuleSet = applyPermissionUpdate(activeRuleSet, u)
                canUseTool = buildGate()
              }
              if (o.permissionDecision === 'allow' || o.decision === 'approve') preApproved = true
              if (o.permissionDecision === 'deny' || o.decision === 'block')
                preDenied = o.permissionDecisionReason || 'Denied by PermissionRequest hook'
              if (o.additionalContext) extraContext += o.additionalContext + '\n'
            }

            const decision: PermissionResult = preDenied
              ? { behavior: 'deny', message: preDenied }
              : preApproved
                ? { behavior: 'allow' }
                : canUseTool
                  ? await canUseTool(name, input, { signal, toolUseId: call.id })
                  : { behavior: 'allow' }

            if (decision.behavior === 'deny') {
              await denyTool(decision.message)
              if (decision.interrupt) abortController?.abort()
            } else {
              if ('updatedInput' in decision && decision.updatedInput)
                input = decision.updatedInput
              try {
                const r = await tool.run(input, ctx)
                content = r.content
                isError = !!r.isError
              } catch (err) {
                content = `Error executing ${name}: ${
                  err instanceof Error ? err.message : String(err)
                }`
                isError = true
              }
              if (isError) {
                await runHooks('PostToolUseFailure', {
                  hook_event_name: 'PostToolUseFailure',
                  tool_name: name,
                  tool_input: input,
                  tool_use_id: call.id,
                  error: resultToText(content),
                })
              } else if (MUTATING_FILE_TOOLS.has(name) && typeof input.path === 'string') {
                await runHooks('FileChanged', {
                  hook_event_name: 'FileChanged',
                  file_path: input.path,
                  event: name === 'delete_file' ? 'unlink' : 'change',
                })
              }
              // PostToolUse hooks.
              const post = await runHooks('PostToolUse', {
                hook_event_name: 'PostToolUse',
                tool_name: name,
                tool_input: input,
                tool_response: content,
                tool_use_id: call.id,
              })
              extraContext += post
                .map((o) => (o && o.additionalContext) || '')
                .filter(Boolean)
                .join('\n')
            }
          }
        }

        let textOut = resultToText(content) + (extraContext ? '\n' + extraContext : '')

        // Large-output handling: spill oversized text results to a file and
        // replace them with a preview + path the model reads via read_file.
        // Skipped for media results and for tools that opt out (maxResultChars).
        if (persistLargeResults && typeof content === 'string') {
          const threshold = tool?.maxResultChars ?? maxToolResultChars
          textOut = await maybePersistLargeResult(
            textOut,
            call.id,
            workspace,
            cwd,
            threshold
          )
        }

        // The tool message itself carries text only (OpenAI tool messages can't
        // hold image parts); media is forwarded as a user turn below so it
        // reaches every provider.
        history.push({ role: 'tool', tool_call_id: call.id, content: textOut })

        if (Array.isArray(content)) {
          for (const b of content) {
            if (b.type === 'image' || b.type === 'document') turnMedia.push(b)
          }
        }

        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: typeof content === 'string' ? textOut : toToolResultContent(content),
          is_error: isError || undefined,
        })
      }

      // Forward any image/PDF bytes from this turn's tools to the model as a
      // user turn (provider-agnostic multimodal delivery).
      if (turnMedia.length) {
        history.push({
          role: 'user',
          content: [
            { type: 'text', text: 'Attached file content from the tools above:' },
            ...turnMedia,
          ],
        })
      }

      yield {
        type: 'user',
        message: { role: 'user', content: toolResultBlocks },
        parent_tool_use_id: null,
        isSynthetic: true,
        timestamp: new Date().toISOString(),
        uuid: uuid(),
        session_id: sessionId,
      }
    }

    await runHooks('Stop', {
      hook_event_name: 'Stop',
      last_assistant_message: lastText,
    })

    const durationMs = Date.now() - startedAt
    const costUSD = computeCostUSD(resultModel, usageTotal)
    const modelUsage: Record<string, ModelUsage> = {
      [resultModel]: {
        inputTokens: usageTotal.input_tokens,
        outputTokens: usageTotal.output_tokens,
        cacheReadInputTokens: usageTotal.cache_read_input_tokens ?? 0,
        cacheCreationInputTokens: usageTotal.cache_creation_input_tokens ?? 0,
        webSearchRequests: 0,
        costUSD,
        contextWindow: contextWindowFor(resultModel),
        maxOutputTokens: 0,
      },
    }

    if (errored || hitMaxTurns) {
      yield {
        type: 'result',
        subtype: hitMaxTurns ? 'error_max_turns' : 'error_during_execution',
        duration_ms: durationMs,
        duration_api_ms: apiMs,
        is_error: true,
        num_turns: turns,
        stop_reason: hitMaxTurns ? 'max_turns' : 'error',
        total_cost_usd: costUSD,
        usage: usageTotal,
        modelUsage,
        permission_denials: denials,
        errors: errored ? [errored] : [`Reached max turns (${maxTurns})`],
        uuid: uuid(),
        session_id: sessionId,
      }
    } else {
      yield {
        type: 'result',
        subtype: 'success',
        duration_ms: durationMs,
        duration_api_ms: apiMs,
        is_error: false,
        num_turns: turns,
        result: lastText,
        stop_reason: 'end_turn',
        total_cost_usd: costUSD,
        usage: usageTotal,
        modelUsage,
        permission_denials: denials,
        uuid: uuid(),
        session_id: sessionId,
      }
    }

    // Persist the transcript for resume after each completed prompt.
    if (options.sessionStore) {
      try {
        await options.sessionStore.save(sessionId, history, { model })
      } catch {
        /* persistence is best-effort */
      }
    }

    // Survivor: hit the time budget. The transcript is persisted (above); signal
    // the client to continue the run in a fresh invocation (resume + continueRun).
    if (paused) {
      yield {
        type: 'system',
        subtype: 'paused',
        reason: 'time_budget',
        session_id: sessionId,
        uuid: uuid(),
      } as unknown as SDKMessage
      break
    }
  }

  // The prompt stream is exhausted — the session is ending.
  await runHooks('SessionEnd', { hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' })
}

/** Prepend a continue-sentinel turn so the loop continues a resumed transcript. */
async function* withContinueSentinel(
  prompt: AsyncIterable<SDKUserMessage>
): AsyncIterable<SDKUserMessage> {
  yield {
    type: 'user',
    message: { role: 'user', content: '' },
    parent_tool_use_id: null,
    __continue: true,
  } as unknown as SDKUserMessage
  yield* prompt
}
