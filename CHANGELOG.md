# Changelog

All notable changes to this repository are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the packages
follow [Semantic Versioning](https://semver.org/).

This repo publishes two packages: **anyclaude-sdk** and **anyclaude-react**.

## anyclaude-sdk

### 0.4.6
- `compactWithWindow(history, llm, { keepRecent })` — window-aware compaction: keep recent turns verbatim + summarize the older prefix (far less lossy than `summarizeHistory`).
- Surfaced the inline tool-call parser via `anyclaude-sdk/llm` (`hasInlineToolCalls`, `parseInlineToolCalls`) — recover tool calls a weak model emitted as text.
- New browser-safe à-la-carte subpath exports: `anyclaude-sdk/permissions` (rulesToCanUseTool, isDangerousBash, plan-mode), `anyclaude-sdk/skills`, `anyclaude-sdk/queue`, `anyclaude-sdk/prompt`.

### 0.4.5
- Added browser-safe subpath export `anyclaude-sdk/compact` (`estimateTokens`, `summarizeHistory`) so compaction can be used à la carte without the root barrel pulling Node/comlink.

### 0.4.4
- Added `WORKSPACE_TOOL_NAMES` (bash + file tools) — pass as `query({ clientTools: WORKSPACE_TOOL_NAMES })` to run the workspace tools on the host (browser WebContainer / IndexedDB) instead of server-side.
- `DexieFileSystem` now accepts an existing Dexie instance via `{ db }`, so the IndexedDB workspace can share a database your app already owns.

### 0.4.3
- Added `defineSkill({ name, description, instructions, argumentHint? })` for ergonomic, validated **programmatic skill declaration** via `query({ skills: [...] })` (parallels `defineTool`). Each skill becomes a `/name` slash command and is invokable through the `skill` tool; `$ARGUMENTS` is substituted at call time.
- Fixed the `init` system message: `slash_commands` and `skills` are now populated (built-ins + custom commands + skills) instead of empty arrays.

### 0.4.2
- Added browser-safe subpath exports `anyclaude-sdk/session` and `anyclaude-sdk/memory` so the IndexedDB `SessionStore` (and memory store) can be imported in browser bundles without pulling in `sandbox/local` (Node builtins) or `background/worker` (comlink). Use these subpaths in front-end code.

### 0.4.1
- Fixed the `bash` tool failing with `Error executing bash: [object Object]` on a
  fresh WebContainer: `WebContainerWorkspace.exec` now ensures the working
  directory exists before spawning `jsh` (a new container only has `/`), falls
  back to a default cwd, and surfaces a real error message. The `bash` tool now
  returns a clean tool error instead of crashing the turn, and the agent loop
  stringifies non-`Error` tool failures properly.

### 0.4.0
- Added `projectMessages` — an opt-in, server-side stream transform that redacts
  system prompt / tool instructions / retrieved context / reasoning / model
  identity from browser-facing message streams. Preserves `paused` and
  `client_tool_request` control messages.

### 0.3.0
- Added `ask_user_question` tool + `onAskUser` handler (ports Claude Code's
  AskUserQuestion); registered only when a handler is provided.
- Added client-side tools: `clientTools` emits a `client_tool_request` and pauses;
  resume with `continueRun` + `clientToolResults` (server brain, browser hands).

### 0.2.0
- Added the serverless "survivor": `maxDurationMs` pauses at a turn boundary and
  emits `paused`; `resume` + `continueRun` continues the loop in a new invocation.
- Pluggable `SessionStoreLike` with adapters: `SessionStore` (IndexedDB),
  `MemorySessionStore`, `KVSessionStore`, `RedisSessionStore`,
  `PostgresSessionStore`, `SupabaseSessionStore`.
- Added custom tools (`defineTool` + additive `extraTools`) and tool selection
  (`allowedTools` / `disallowedTools`).
- Added `MessageQueue` for interjecting messages into a live run.

### 0.1.0
- Initial release: `query()` async-generator, the tool loop, the full built-in
  toolset, multi-turn, MCP, sub-agents, hooks, skills, memory, slash commands,
  pluggable LLM clients (OpenAI / Anthropic / Responses), and pluggable
  workspaces (WebContainer / Memory / local).

## anyclaude-react

### 0.4.0
- Moved `Terminal` + `CodeEditor` to the `anyclaude-react/ide` subpath so the root barrel no longer pulls `@xterm/*` or `codemirror` into the module graph — chat-only consumers no longer need those peers installed. **BREAKING:** import `Terminal`/`CodeEditor` from `anyclaude-react/ide` instead of the root. `FileExplorer` + `AskUser` remain in the root (no heavy deps).

### 0.3.0
- Added `createWorkspaceClientTools(workspace)` and `createWebContainerClientTools(wc)` — turn the SDK built-in workspace tools into a client-tool executor map backed by ANY workspace (WebContainer, IndexedDB `DexieFileSystem`, OPFS, memory). Reuses the real SDK tool impls (exact parity); `bash` included only when the workspace has a shell; per-tool overridable. peerDep `anyclaude-sdk>=0.4.4`.

### 0.2.2
- Docs: README refreshed (IDE components, client-side tools, streamdown).

### 0.2.1
- Fixed tool pills collapsing to a thin red sliver inside the transcript flex
  column (`flex-shrink: 0`).

### 0.2.0
- Added IDE components: `Terminal`, `FileExplorer`, `CodeEditor`, `ChatPanel`,
  `AskUser`.
- Added client-side tool handling in the client (`clientTools` executor map;
  `client_tool_request`s run in the browser and results are streamed back).
- Switched markdown rendering to `streamdown`.

### 0.1.0
- Initial release: `useAgent()` hook; `createAgentClient` / `createEndpointClient`
  with serverless survivor stream-stitching; components `AgentChat`,
  `Transcript`, `Message` / `MarkdownMessage`, `ToolCall`, `Composer`, `Working`.
