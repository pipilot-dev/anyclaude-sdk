// Core types for browser-claude-sdk — a local, browser-compatible implementation
// of Claude Code agent capabilities.
//
// The `SDK*` message family mirrors the official `@anthropic-ai/claude-agent-sdk`
// message envelope (see Claude Code's sdk/coreSchemas.ts) so consumers written
// against the real SDK can iterate our `query()` output unchanged. The
// transport-layer interfaces (LLMClient / ChatMsg / ToolDef / ToolCall /
// FileSystem / CommandExecutor) are our own OpenAI-compatible additions.

// ============================================================================
// Anthropic content blocks (match @anthropic-ai/sdk ContentBlock(Param))
// ============================================================================

export type TextBlock = { type: 'text'; text: string }

export type ThinkingBlock = {
  type: 'thinking'
  thinking: string
  signature?: string
}

export type ToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export type ImageBlock = {
  type: 'image'
  source: { type: 'base64'; media_type: string; data: string }
}

/** PDF / document block (Anthropic-native; matches @anthropic-ai/sdk DocumentBlockParam). */
export type DocumentBlock = {
  type: 'document'
  source:
    | { type: 'base64'; media_type: 'application/pdf'; data: string }
    | { type: 'text'; media_type: 'text/plain'; data: string }
  title?: string
  context?: string
}

export type ToolResultBlock = {
  type: 'tool_result'
  tool_use_id: string
  content: string | Array<TextBlock | ImageBlock | DocumentBlock>
  is_error?: boolean
}

export type ContentBlockParam =
  | TextBlock
  | ThinkingBlock
  | ToolUseBlock
  | ToolResultBlock
  | ImageBlock
  | DocumentBlock

// ============================================================================
// Anthropic API message shapes (the `message` payload inside SDK messages)
// ============================================================================

export type StopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'stop_sequence'
  | 'tool_use'
  | 'pause_turn'
  | 'refusal'
  | null

/** Mirrors @anthropic-ai/sdk MessageParam for role: 'user'. */
export type APIUserMessage = {
  role: 'user'
  content: string | ContentBlockParam[]
}

/** Mirrors @anthropic-ai/sdk Message (assistant turn). */
export type APIAssistantMessage = {
  id: string
  type: 'message'
  role: 'assistant'
  model: string
  content: ContentBlockParam[]
  stop_reason: StopReason
  stop_sequence: string | null
  usage: Usage
}

export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export type ModelUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  webSearchRequests: number
  costUSD: number
  contextWindow: number
  maxOutputTokens: number
}

export type ApiKeySource = 'user' | 'project' | 'org' | 'temporary' | 'oauth' | 'none'

export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'plan'
  | 'dontAsk'

// ============================================================================
// SDK message family (faithful to the official Agent SDK envelope)
// ============================================================================

export type SDKUserMessage = {
  type: 'user'
  message: APIUserMessage
  parent_tool_use_id: string | null
  /** ISO 8601 timestamp; optional to match the SDK (consumers fall back to receive time). */
  timestamp?: string
  isSynthetic?: boolean
  uuid?: string
  session_id?: string
}

export type SDKAssistantMessageError =
  | 'authentication_failed'
  | 'billing_error'
  | 'rate_limit'
  | 'invalid_request'
  | 'server_error'
  | 'unknown'
  | 'max_output_tokens'

export type SDKAssistantMessage = {
  type: 'assistant'
  message: APIAssistantMessage
  parent_tool_use_id: string | null
  error?: SDKAssistantMessageError
  uuid: string
  session_id: string
}

/** A streaming delta event (mirrors SDKPartialAssistantMessage / 'stream_event'). */
export type SDKPartialAssistantMessage = {
  type: 'stream_event'
  event: RawMessageStreamEvent
  parent_tool_use_id: string | null
  uuid: string
  session_id: string
}

/** Minimal stream-event shape; matches the Anthropic streaming event tags we emit. */
export type RawMessageStreamEvent =
  | { type: 'message_start'; message: Partial<APIAssistantMessage> }
  | { type: 'content_block_start'; index: number; content_block: ContentBlockParam }
  | {
      type: 'content_block_delta'
      index: number
      delta:
        | { type: 'text_delta'; text: string }
        | { type: 'input_json_delta'; partial_json: string }
        | { type: 'thinking_delta'; thinking: string }
    }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason?: StopReason }; usage?: Partial<Usage> }
  | { type: 'message_stop' }

export type SDKSystemMessage = {
  type: 'system'
  subtype: 'init'
  apiKeySource: ApiKeySource
  cwd: string
  tools: string[]
  mcp_servers: Array<{ name: string; status: string }>
  model: string
  permissionMode: PermissionMode
  slash_commands: string[]
  output_style: string
  skills: string[]
  agents?: string[]
  uuid: string
  session_id: string
}

export type SDKCompactBoundaryMessage = {
  type: 'system'
  subtype: 'compact_boundary'
  compact_metadata: {
    trigger: 'manual' | 'auto'
    /** Transcript token estimate when compaction began. */
    pre_tokens: number
    /**
     * Compaction phase: `'start'` is emitted BEFORE the (possibly slow)
     * summarization so a UI can show a live "compacting…" indicator; `'end'`
     * is emitted after, with `post_tokens` set. Absent ⇒ treat as `'end'`
     * (back-compat: pre-0.6.2 only emitted the post-compaction boundary).
     */
    status?: 'start' | 'end'
    /** Transcript token estimate after compaction (only on `status: 'end'`). */
    post_tokens?: number
  }
  uuid: string
  session_id: string
}

/** Output of a local slash command (e.g. /help, /cost). */
export type SDKLocalCommandOutputMessage = {
  type: 'system'
  subtype: 'local_command_output'
  content: string
  uuid: string
  session_id: string
}

export type SDKPermissionDenial = {
  tool_name: string
  tool_use_id: string
  tool_input: Record<string, unknown>
}

export type SDKResultMessage =
  | {
      type: 'result'
      subtype: 'success'
      duration_ms: number
      duration_api_ms: number
      is_error: boolean
      num_turns: number
      result: string
      stop_reason: string | null
      total_cost_usd: number
      usage: Usage
      modelUsage: Record<string, ModelUsage>
      permission_denials: SDKPermissionDenial[]
      uuid: string
      session_id: string
    }
  | {
      type: 'result'
      subtype:
        | 'error_during_execution'
        | 'error_max_turns'
        | 'error_max_budget_usd'
      duration_ms: number
      duration_api_ms: number
      is_error: boolean
      num_turns: number
      stop_reason: string | null
      total_cost_usd: number
      usage: Usage
      modelUsage: Record<string, ModelUsage>
      permission_denials: SDKPermissionDenial[]
      errors: string[]
      uuid: string
      session_id: string
    }

export type SDKMessage =
  | SDKUserMessage
  | SDKAssistantMessage
  | SDKPartialAssistantMessage
  | SDKSystemMessage
  | SDKCompactBoundaryMessage
  | SDKLocalCommandOutputMessage
  | SDKResultMessage

// ============================================================================
// Agent session state, permissions & hooks (mirrors the SDK's control surface)
// ============================================================================

/** A todo item managed by the todo_write tool. */
export type TodoItem = {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
}

/**
 * Definition of a custom sub-agent invokable via the `task` tool (mirrors the
 * official SDK's AgentDefinition subset).
 */
export type AgentDefinition = {
  /** Natural-language description of when to use this agent. */
  description: string
  /** The sub-agent's system prompt. */
  prompt: string
  /** Allowed tool names. If omitted, inherits the parent's tools (minus `task`). */
  tools?: string[]
  /** Model override for this sub-agent. If omitted, inherits the parent model. */
  model?: string
}

/** Mutable per-session state shared with tools (todos, config, etc.). */
export type AgentStore = {
  todos: TodoItem[]
  /** Free-form session config key/value store (used by the `config` tool). */
  config?: Record<string, unknown>
}

/** Result of a permission check — allow (optionally with modified input) or deny. */
export type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message: string; interrupt?: boolean }

/**
 * Permission gate invoked before each tool runs. Return allow/deny.
 * Mirrors the official SDK's `canUseTool` option.
 */
export type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: { signal?: AbortSignal; toolUseId: string }
) => Promise<PermissionResult> | PermissionResult

/** Lifecycle hook events we surface (subset of the SDK's 27 hook events). */
export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'PermissionRequest'
  | 'PermissionDenied'
  | 'FileChanged'
  | 'UserPromptSubmit'
  | 'Notification'
  | 'Stop'
  | 'SessionStart'
  | 'SessionEnd'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'PreCompact'
  | 'PostCompact'

export type PreToolUseHookInput = {
  hook_event_name: 'PreToolUse'
  tool_name: string
  tool_input: Record<string, unknown>
  tool_use_id: string
}

export type PostToolUseHookInput = {
  hook_event_name: 'PostToolUse'
  tool_name: string
  tool_input: Record<string, unknown>
  tool_response: unknown
  tool_use_id: string
}

/** Generic lifecycle hook input (session/subagent/compaction/prompt/permission/file events). */
export type LifecycleHookInput = {
  hook_event_name:
    | 'UserPromptSubmit'
    | 'Notification'
    | 'Stop'
    | 'SessionStart'
    | 'SessionEnd'
    | 'SubagentStart'
    | 'SubagentStop'
    | 'PreCompact'
    | 'PostCompact'
    | 'PermissionRequest'
    | 'PermissionDenied'
    | 'PostToolUseFailure'
    | 'FileChanged'
  [key: string]: unknown
}

export type HookInput = PreToolUseHookInput | PostToolUseHookInput | LifecycleHookInput

/** A permission update a PermissionRequest hook may suggest. */
export type PermissionUpdateSuggestion = {
  type: 'addRules' | 'replaceRules' | 'removeRules'
  behavior?: 'allow' | 'deny' | 'ask'
  rules?: Array<{ toolName: string; ruleContent?: string }>
}

/**
 * Hook callback output. `permissionDecision` on PreToolUse can short-circuit a
 * tool ('deny'/'ask'→deny); `additionalContext` is appended to the tool result.
 */
export type HookOutput = {
  decision?: 'approve' | 'block'
  permissionDecision?: 'allow' | 'deny' | 'ask'
  permissionDecisionReason?: string
  additionalContext?: string
  systemMessage?: string
  /** Permission rule updates suggested by a PermissionRequest hook. */
  permissionUpdates?: PermissionUpdateSuggestion[]
} | void

export type HookCallback = (
  input: HookInput,
  options: { signal?: AbortSignal }
) => Promise<HookOutput> | HookOutput

// ============================================================================
// Transport layer — OpenAI-compatible tool/LLM interfaces (our own additions)
// ============================================================================

// Tool definition types (OpenAI-compatible function calling)
export type ToolDef = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, unknown>
      required?: string[]
    }
  }
}

export type ToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

// File system interface that works with WebContainer or any FS-like backend
export interface FileSystem {
  readFile(path: string): Promise<string | null>
  readBinary(path: string): Promise<Uint8Array | null>
  writeFile(path: string, contents: string): Promise<void>
  writeBinary(path: string, data: Uint8Array): Promise<void>
  deleteFile(path: string): Promise<void>
  readdir(path: string): Promise<Array<{ name: string; isDir: boolean }> | null>
  mkdir(path: string): Promise<void>
}

// Command execution interface
export interface CommandExecutor {
  exec(
    command: string,
    timeoutMs?: number,
    env?: Record<string, string>
  ): Promise<{
    output: string
    exitCode: number
  }>
}

// LLM client interface (OpenAI/Anthropic compatible, normalized)
export interface LLMClient {
  streamChat(
    messages: ChatMsg[],
    opts: {
      model?: string
      tools?: ToolDef[]
      signal?: AbortSignal
      onToken: (delta: string) => void
      onTool?: (calls: ToolCall[]) => void
    }
  ): Promise<StreamResult>
}

export type ChatMsg = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | ContentBlockParam[]
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export type StreamResult = {
  text: string
  toolCalls: ToolCall[]
  model: string
  usage?: Usage
  stopReason?: StopReason
}
