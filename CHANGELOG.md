# Changelog

All notable changes to this repository are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the packages
follow [Semantic Versioning](https://semver.org/).

This repo publishes two packages: **anyclaude-sdk** and **anyclaude-react**.

## anyclaude-sdk

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
