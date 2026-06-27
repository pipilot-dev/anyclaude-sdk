# Changelog

All notable changes to this repository are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the packages
follow [Semantic Versioning](https://semver.org/).

This repo publishes two packages: **anyclaude-sdk** and **anyclaude-react**.

## anyclaude-sdk

### 0.7.1
- Telemetry now defaults to a live aggregate-only collector (`https://anyclaude-telemetry.puter.work`, a Puter Worker — source in `examples/telemetry-collector/puter-worker.js`). All opt-outs (`ANYCLAUDE_TELEMETRY=0` / `DO_NOT_TRACK` / `CI` / `disableTelemetry` / browser localStorage) and the `ANYCLAUDE_TELEMETRY_URL` override are unchanged; set the URL to `''` to disable sending. The schema and privacy guarantees from 0.7.0 are identical.

### 0.7.0
- **Anonymous, opt-out usage telemetry** (`anyclaude-sdk/telemetry`) — answers "are people adopting it, and which parts?" in aggregate, never per-user. One `run` event per `query()`: `sdk_version`, `runtime`, a random non-identifying `install` id, a coarse `model_family` bucket, and feature booleans. **Never** sends repo URLs, project names, paths, source, prompts, tool args, LLM responses, API keys, or endpoints — `track()` whitelists prop keys + value types and drops everything else. Off via `ANYCLAUDE_TELEMETRY=0` / `DO_NOT_TRACK=1` / any `CI` / `query({ disableTelemetry: true })` / browser `localStorage['anyclaude_telemetry']='0'`, and a **no-op unless a collector URL is configured** (`ANYCLAUDE_TELEMETRY_URL` / `telemetry: { url }`). Fire-and-forget; never blocks or throws. Full disclosure in `TELEMETRY.md`; reference collector in `examples/telemetry-collector`. Exports `track`, `telemetryEnabled`, `detectRuntime`.

### 0.6.2
- Auto-compaction now emits a **`compact_boundary` with `status: 'start'` BEFORE** the (possibly slow) summarization, then `status: 'end'` after — so a UI can show a live "compacting…" indicator during the work instead of only a retroactive marker. `compact_metadata` gains `status?: 'start' | 'end'` and `post_tokens?` (token estimate after compaction); `pre_tokens` on auto-compaction is now the real transcript estimate (was the threshold). `status` is absent only on pre-0.6.2 streams — treat absent as `'end'` (backward-compatible). Manual `/compact` emits a single `status: 'end'` boundary.

### 0.6.1
- `MessageQueue`: each queued message now carries a stable `id`, `push()` returns it, and a new `remove(id)` cancels a single pending message (e.g. a per-pill ✕ in the UI) — previously only `shift`/`clear` were available, so an individual queued item couldn't be cancelled mid-run. `remove` returns `false` for unknown / already-drained ids and doesn't fire `onChange` in that case. Additive and backward-compatible (`push`'s return value was `void`).

### 0.6.0
- **`anyclaude-sdk/anthropic-endpoint`** (new browser-clean subpath) — bridge the Anthropic Messages API to any OpenAI-compatible model via the SDK's `LLMClient`. Stand up a drop-in **claude-code-router**: point Claude Code (or any Anthropic-Messages client) at your server via `ANTHROPIC_BASE_URL` and run it against DeepSeek / Qwen / GLM / Kimi / local Ollama. Exports: `anthropicToChat` (Anthropic request → `ChatMsg[]` + `ToolDef[]`, splitting `tool_result` blocks into `tool` messages), `anthropicSSE` (run a turn → the exact Anthropic SSE event sequence), `streamResultToAnthropicMessage` (non-streaming), `anthropicToolsToDefs`. Inline tool-call **dialects are recovered into proper `tool_use` blocks**, so tool use works on cheap/open models — and raw `<tool_call>` markup never leaks into text deltas.
- New example **`examples/claude-code-router`** — a zero-dependency Node server demonstrating the above, with config-driven routing (default / background / long-context) across providers.

### 0.5.0
- **Reliable tool use on cheap/open models** — three layers so the same agent loop works beyond GPT/Claude (Qwen, DeepSeek, Kimi, GLM, Mistral, Llama/Ollama), exported from `anyclaude-sdk/llm`:
  - **Tool-call dialects** (`parseToolCalls`, `hasToolCalls`, `dialects`): recover tool calls a model emitted as TEXT — `xml-function`, `hermes` (`<tool_call>{json}</tool_call>`), and `json-fence` (```json blocks). Conservative detection won't misread ordinary JSON output. `parseInlineToolCalls` now spans all three (back-compat).
  - **Model profiles** (`profileForModel`, `builtinProfiles`, `toolGuidancePrompt`): auto-detected per-model defaults for dialects, `tool_choice`, `parallel_tool_calls`, and temperature. `createOpenAIClient` gains `profile` + `toolDialects` options (explicit options always win; auto-detects from the model id when omitted).
  - **Self-healing argument repair** (`validateToolArguments`, `query({ repairToolCalls })`, default on): validate tool args against the schema before executing; on malformed/incomplete JSON, return a corrective `is_error` tool_result (naming the problem + expected schema) so the model retries instead of running with garbage. Wired into both `query()` and `runToolLoop({ repairToolCalls })`.
- **Compatibility-matrix harness** (`scripts/compat-matrix.mjs` + `compat.config.example.json`): run the real loop against any list of endpoints and print a native-vs-with-anyclaude pass/fail table. CI-runnable; keys via `env:NAME`.

### 0.4.9
- `anyclaude-sdk/llm` now exports the canonical OpenAI wire mappers — `toOpenAIMessages(msgs)` / `toOpenAIMessage(msg)`, `blocksToOpenAIContent`, `blocksToText`, and the `OpenAIChatMessage` type. Custom `LLMClient` authors who bring their own transport (proxy / encryption / alternate URL) can reuse the SDK's exact `ChatMsg → /chat/completions` conversion (text / image / PDF `document` / `tool_result`) instead of forking it and drifting.
- `anyclaude-sdk/llm` now re-exports the LLM client types (`LLMClient`, `ChatMsg`, `StreamResult`, `ToolCall`, `ToolDef`, `StopReason`, `Usage`, `ContentBlockParam`) as type-only — so custom-client authors get full typing from the browser-clean subpath without importing the bare root (which pulls `node:child_process` + comlink into a browser bundle).

### 0.4.8
- `query({ clientWorkspaceTools: true })` — one switch to delegate ALL built-in file/bash tools to the host (server emits client_tool_request, never runs them against its in-memory FS). Pair with anyclaude-react createWorkspaceClientTools.
- Run-less `defineTool({ name, description, parameters })` (no `run`) is now auto-delegated as a client tool (Vercel "no execute = client" convention). `Tool.run` is optional.
- `runToolLoop({ clientTools, onClientTool })` — inline client-tool delegation in the standalone engine (for duplex/in-browser); names in clientTools or run-less tools route to onClientTool instead of ctx.

### 0.4.7
- `runToolLoop(opts)` (`anyclaude-sdk/loop`) — the standalone in-process tool-loop engine that powers query() (call → execute via ctx → append → stop on no-tool-calls/maxTurns), decoupled from sessions/MCP/survivor/sub-agents. Same SDKMessage envelopes, browser-clean. For consumers who want just the loop.

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

### 0.5.0
- **`useWebContainerPreview({ wc })`** — boot a dev server inside a WebContainer and get back a live preview URL for an `<iframe>` (waits for the container's `server-ready` event), with streamed logs, status, and `start`/`stop`/`restart`. The fiddly core of building an in-browser AI IDE, packaged as a hook. Structurally typed against `@webcontainer/api` (no hard peer dep).
- Internal: guard the now-optional `Tool.run` in `createWorkspaceClientTools` (SDK 0.4.8 made `run` optional).

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
