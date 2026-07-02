# Changelog

All notable changes to this repository are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the packages
follow [Semantic Versioning](https://semver.org/).

This repo publishes two packages: **anyclaude-sdk** and **anyclaude-react**.

## anyclaude-sdk

### 0.14.5
- **No console output by default (production-quiet).** The SDK no longer writes anything to the console unless you ask it to:
  - **Telemetry notice** — the one-time "telemetry is on" line is now opt-in (`ANYCLAUDE_TELEMETRY_NOTICE=1` or `globalThis.__ANYCLAUDE_TELEMETRY_NOTICE__=true`). **Collection is unchanged** — still anonymous, still opt-out via `ANYCLAUDE_TELEMETRY=0`, still documented in TELEMETRY.md.
  - **Update check** — silent by default and it no longer even pings the npm registry on its own. Opt into the one-line hint with `ANYCLAUDE_UPDATE_NOTICE=1` / `__ANYCLAUDE_UPDATE_NOTICE__=true`, pass your own `log`, or call `checkForUpdate()` for the signal with zero console output.
  - **Retry warnings** — silent by default; opt in with `retry: { logRetries: true }` or route them via `retry: { onRetry }`.
- **Single version source.** `src/version.ts` is now auto-generated from `package.json` on `prebuild` (`scripts/sync-version.mjs`), so `SDK_VERSION` can never drift from the published version again (the cause of the 0.14.2/0.14.3 mismatch). Bump only `package.json`.

### 0.14.4
- chore(release): correct the internal `SDK_VERSION` string. 0.14.2/0.14.3 were built with `version.ts` lagging the published `package.json`, so those packages reported an older `SDK_VERSION` in telemetry / `checkForUpdate()`. No API or behavior change — `keepImages` (0.14.2) and `alwaysOnTools` (0.14.3) are unchanged; this just realigns the version string.

### 0.14.3
- **New `alwaysOnTools?: string[]` (allowlist tool cap).** Send ONLY the named tools (plus `tool_search`) in the per-turn payload and DEFER every other tool — crucially including the team/background/plan/MCP tools the SDK injects internally, which a `deferredTools` **denylist** can't enumerate. Deferred tools stay discoverable + executable via `tool_search`. Takes precedence over `deferredTools`. Use to hard-cap the sent tool surface to a small core (e.g. ~20) regardless of which features add tools.

### 0.14.2
- **New `keepImages?: number` (context editing for vision).** Keeps only the most recent N tool-forwarded image turns verbatim; image blocks in older forwarded-media turns are replaced with a short text stub before each LLM call. A read image is already processed when first read, so it no longer rides along in full on every subsequent turn — a large saving on long multimodal runs (the agent can re-read the file to see it again). Only the tool-forwarded media turns are touched; the user's own attached images are left intact. Mirrors `keepToolResults`; off when undefined.

### 0.14.1
Two fixes for the end-of-run experience (seen in the wild — a run ending in a blank "(empty response)" after a `finish` tool):
- **No more blank trailing turn.** When a model returns a wholly-empty turn (no text, no tool calls — e.g. only a reasoning/thinking block, which happens right after a terminal tool when it has nothing left to say), the SDK no longer emits an assistant message with an empty `content` array. That empty array was rendering as a blank "(empty response)" bubble. The run's `result` still carries the last meaningful text.
- **Terminal tools — `defineTool({ endsTurn: true })`.** A tool marked `endsTurn` ends the run as soon as it executes, with **no follow-up LLM call**. Use it for an explicit `finish`/`done` tool the model calls to signal completion — previously the loop made one more round-trip that just returned an empty turn (wasted tokens + latency). New `Tool.endsTurn` / `DefineToolSpec.endsTurn`.

### 0.14.0
- **Local stdio MCP servers** — `query({ mcpServers: { fs: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/work'] } } })`. The SDK spawns the command as a child process and speaks newline-delimited JSON-RPC over stdin/stdout (the transport Claude Code and most MCP servers use), discovering tools and exposing them as `mcp__<server>__<tool>` just like HTTP/SSE/in-process servers. Config: `command`, `args?`, `env?` (merged over parent env), `cwd?`, `timeoutMs?` (default 60s). **Node/Bun only** — `node:child_process` is lazy-imported so the browser build stays clean, and in the browser a stdio server reports a `failed` status (clear message) without affecting the run. The child is `unref()`-ed (never blocks process exit) and killed on the run's `abortController` abort or `StdioMcpClient.close()`. New exports: `StdioMcpClient`, `McpStdioServerConfig`. Pairs naturally with `LocalSandbox` for a Claude-Code-like local agent.

### 0.13.1
Retry-policy refinements (follow-ups to 0.13.0):
- **Smarter 401 handling.** A `401` is now retried at most once by default (`authRetries: 1`) instead of consuming the full 10-attempt budget — transient cold-start/key-refresh 401s still clear, but a genuinely bad key fails fast (~1s) instead of stalling ~90s. Set `authRetries: 0` to never retry 401, or raise it.
- **Real randomized jitter.** Backoff jitter is now actually random (`±20%` by default via `Math.random`, injectable via `random` for tests) instead of a deterministic cycle — so many clients hitting the same `429` no longer retry in lockstep.
- **Retry visibility.** Retries are no longer silent: by default each one logs a one-line `console.warn` (`LLM http 429 — retry 2/10 in 2000ms`). Provide `retry: { onRetry }` to route retries into your own logger/telemetry, or `retry: { silent: true }` to quiet them. New `RetryInfo` type.

### 0.13.0
- **Automatic retries on transient LLM failures (shared policy, all built-in clients).** The engine previously threw on the *first* non-OK response — a single transient `401`/`429`/`5xx`, a dropped socket, or a network blip killed the whole run. Now `createOpenAIClient` / `createAnthropicClient` / `createResponsesClient` retry up to **10×** with exponential backoff capped at 30s (`1→2→4→8→16→30…s`), honoring a `Retry-After` header when present. Retryable: network errors, `401`/`408`/`409`/`429`/`5xx`, and pre-stream socket drops. **Hard safety rule:** a request is only retried if *nothing has streamed to the consumer yet* — once tokens (or tool-call deltas) are emitted, the error surfaces instead of double-emitting. Tune or disable per client via `retry: { maxAttempts, baseMs, maxMs, retryStatus, … }` or `retry: false`. New `anyclaude-sdk/llm` exports: `withRetry`, `RetryPolicy`, `isRetryableStatus`, `HttpError`, `parseRetryAfter`, `noRetry`, `resolveRetry`. (Note: `401` is retried by default because some gateways emit transient 401s on cold-start/key-refresh; override `retryStatus` to exclude it for a hard-auth endpoint.)

### 0.12.1
- **Opt-in `project` telemetry label (consensual attribution).** `query({ telemetry: { project: 'my-app' } })` sends a `project:<label>` counter so *you* can attribute your own usage in the aggregate data. **Off by default** — nothing identifying is ever sent unless you set it. Sanitized to ≤40 safe chars (and re-sanitized server-side). This is the only identifying field in the schema and it exists solely because the integrator opts in. See TELEMETRY.md.

### 0.12.0
- **Update check (non-blocking, opt-out).** New `anyclaude-sdk/update` subpath: `checkForUpdate()` → `{ current, latest, outdated, error? }` (reads the npm registry, memoized per process, browser-throttled, never throws), and `notifyIfOutdated()` which prints **one** friendly console hint when you're behind latest. `query()` fires it automatically (once per process); suppress with `query({ updateCheck: false })`, `ANYCLAUDE_UPDATE_CHECK=0`, `DO_NOT_TRACK=1`, or `CI`. **It never installs anything and never blocks a run** — it's a hint, and the host app can drive its own "update available" UI off `checkForUpdate()`. New single-source `SDK_VERSION` export.
- **Richer (still anonymous/aggregate) `run_end` telemetry.** Added three coarse buckets so adoption data answers reliability/perf questions, not just volume: `outcome` (`completed`/`error`/`max_turns`/`paused`/`aborted`), `turns_bucket` (`1`/`2-5`/`6-20`/`21+`), and `duration_bucket` (`<1s`/`1-10s`/`10-60s`/`1-5m`/`5m+`). New `turnsBucket`/`durationBucket`/`outcomeOf` helpers. Every value remains a fixed enum/bucket — no free-form strings, nothing identifying. See TELEMETRY.md.

### 0.11.3
- docs(readme): surface the multi-agent team system in the headline + intro (it was missing from the npm landing) — coordinator/worker delegation, push delivery to running workers, background supervision, and cross-worker/tab teams via `BroadcastChannelMailbox`. No code change.

### 0.11.2
- **fix(telemetry): `run_end` now fires on every termination path.** It was in a bare `finally`, which only runs when the consumer fully drains or explicitly closes the generator — so streaming consumers that `abort()`/`interrupt()` or abandon the stream mid-run never emitted it (observed firing on <3% of runs, leaving token/outcome data dark). Now emitted exactly once via a guard, triggered by whichever comes first: normal completion, `break`/`.return()`, `abort()`, or `interrupt()`. Verified across all three paths. (Anonymous/aggregate as before — no code, prompts, repo, or keys; see TELEMETRY.md.)

### 0.11.1
- **`dispatch_tasks({ background: true })`** — runs the team loop detached (via the background task manager) and returns immediately with a `bg_<n>` id, so the coordinator keeps control to **monitor and steer workers while they run**: poll `board_list` / `task_get` for live status, `send_message` to `worker:<taskId>` to redirect a running worker mid-task (delivered on its next step), and `task_output <id>` for the final summary. Requires `query({ background: true })`. The default (foreground) dispatch is unchanged. Closes the interactive supervision loop on top of 0.11.0's push delivery. (Verified end-to-end: background dispatch → live `board_list` monitoring → redirect a running worker → worker picks it up and completes.)

### 0.11.0
- **Push delivery to running agents (mailbox → transcript at the turn boundary).** Unread mailbox messages addressed to an agent are now auto-injected into its transcript at each turn boundary — the same delivery model as the message queue, but sourced from the shared mailbox and addressed by agent name. This means a coordinator (or any peer, or the host app, or another Web Worker via `BroadcastChannelMailbox`) can **dispatch a message to a *running* sub-agent and have it land on the sub-agent's next tool round** — no polling tool required. On by default when `team` is enabled; opt out with `query({ deliverTeamMessages: false })`.
- **Addressable workers.** `dispatch_tasks` now names each spawned worker `worker:<taskId>` and records it as the task owner, so the coordinator can target a specific running worker with `send_message`. New `runSubagent({ name })` option + `deliverTeamMessages` on `query()`/`runAgent()`. Coordinator prompt updated to describe mid-task redirection.

### 0.10.2
- **`broadcast-channel` is now a real dependency** (promoted from optional peer) and **`BroadcastChannelMailbox.crossTab()`** wires it up in one call: a durable cross-tab/cross-context mailbox (IndexedDB/localStorage fallbacks, older browsers + Node) without the caller importing the package. `const mb = await BroadcastChannelMailbox.crossTab({ channelName: 'team', origin: 'planner' }); query({ team: true, mailbox: mb })`. The package is lazy-imported inside `crossTab()`, so bundles that never call it don't pull it in. The plain `new BroadcastChannelMailbox()` (global `BroadcastChannel`) path is unchanged.

### 0.10.1
- **fix(background): comlink now ships with the SDK.** The Comlink worker harness (`wrapWorker` / `exposeBackgroundWorker`) lazy-imports `comlink`, but it was a *devDependency* — so it worked in this repo yet threw `Cannot find module 'comlink'` for anyone who `npm i anyclaude-sdk` and used a worker. Moved `comlink` to **`dependencies`** so the worker path works zero-config. Still lazy-imported behind `await import` with `sideEffects: false`, so bundlers don't pull it into browser bundles unless `wrapWorker` is actually used. (Verified the harness end-to-end: a main-thread `wrapWorker(...).run()` executes inside a real worker and returns.)
- **`broadcast-channel` added as an optional peer dependency.** `BroadcastChannelMailbox` defaults to the global `BroadcastChannel` (browsers + Node ≥15) and needs no package; install `broadcast-channel` only for the injected cross-tab / legacy-runtime path.

### 0.10.0
- **`BroadcastChannelMailbox`** — a `Mailbox` that gossips across execution contexts (Web Workers, browser tabs, Node `worker_threads`) over a `BroadcastChannel`. Drop-in for the in-memory `Mailbox`: `query({ team: true, mailbox: new BroadcastChannelMailbox({ channelName: 'team', origin: 'planner' }) })` and the existing `team` tools (`send_message` / `dispatch_tasks`) work **unchanged**, but messages now propagate to every agent on the same channel. This completes the multi-agent-in-separate-workers pattern: pair it with the existing `wrapWorker` / `exposeBackgroundWorker` (Comlink) for main→worker control. Uses the global `BroadcastChannel` by default; inject the `broadcast-channel` npm package (or any `ChannelLike`) via the `channel` option for cross-tab durability or older runtimes. Each instance keeps an eventually-consistent replica; ids are origin-scoped so workers never collide. Exported from the root and `anyclaude-sdk` `team` surface.

### 0.9.0
Three agent-loop efficiency knobs (all opt-in, work in `query()` + `runToolLoop()`):
- **Lean system prompt** — `query({ systemPromptPreset: 'lean' })` uses a ~70% shorter built-in prompt (verified 363 vs 1246 chars). On uncached endpoints that's paid back **every turn**. New `leanSystemPrompt` / `systemPromptFor` exports.
- **Context editing** — `query({ keepToolResults: N })` keeps only the most recent N `tool_result` messages verbatim and replaces older ones with a short stub before each LLM call, capping transcript growth on long runs. (Trades prompt-cache hits on the cleared span for fewer tokens — a clear win on uncached models.)
- **Parallel tool execution** — `query({ parallelToolExecution: true })` runs a turn's tool calls concurrently when all are read-only / `parallelSafe` server tools (mutating tools, bash, and delegated client tools stay serial; results preserve order). ~2× faster on multi-read turns. New `defineTool({ parallelSafe: true })` lets custom read tools opt in.

### 0.8.1
- docs(readme): document deferred tools (token-efficiency section + API option). No code change.

### 0.8.0
- **Deferred tools (lazy tool loading)** — keep a large pool of rarely-used tools OUT of the per-turn payload (big token savings, esp. on weak/uncached models) while staying discoverable and callable. Mark via `query({ deferredTools: ['stripe_charge', …] })` or per-tool `defineTool({ defer: true })`. Deferred tools aren't sent to the model, but `tool_search` indexes them; when it surfaces one, the loop **arms** it (its schema is included on subsequent turns) and it executes normally. New `ToolContext.armTools(names)`. Mirrors Anthropic's tool-search `defer_loading` pattern — register 35 integration tools, send ~10.

### 0.7.4
- **Fix: raw tool-call / reasoning markup leaking into user-visible text.** When a model emitted a tool call in the named-tag dialect (`<finish>…</finish>`, the Cline/Roo/Aider convention) or left stray `<thinking>`/`<tool_call>`/`<function>`/`<parameter>` tags, the SDK didn't recognize them — so the raw tags rendered to the user and the tool never executed (the loop didn't terminate). Now:
  - `parseToolCalls(text, { toolNames })` recovers **named-tag tool calls** scoped to the known tool set (`parseNamedTagToolCalls`), extracting both `<parameter=k>v</parameter>` and direct `<k>v</k>` children.
  - `stripControlTags()` scrubs leaked `<thinking>…</thinking>` blocks and orphan tool-wrapper tags from visible text (conservative — only these well-known tags; ordinary prose like `a<b` is untouched).
  - Both run as a **loop-level safety net** in `query()` and `runToolLoop()` on the final text, so the fix applies to **any** `LLMClient` (including custom gateways that bypass `createOpenAIClient`), not just the built-in client.
  - Streaming delta suppression broadened to `<thinking>` + named-tool tags so markup never flickers mid-stream.

### 0.7.3
- Telemetry: a second anonymous `run_end` event reports a **coarse token-volume bucket** (`tokenBucket`: `<1k` / `1k-10k` / `10k-100k` / `100k-1m` / `1m+`) — never an exact count, so a single run isn't fingerprintable — for adoption-volume stats. Same opt-outs apply. The collector also now tracks unique installs (anonymous id dedupe, never exposed) and per-day buckets.
- New `scripts/adoption-report.mjs` — a **public-data** adoption report (GitHub code search for repos referencing the packages + repo metadata + npm weekly downloads), classifying public dependents by project kind. Collects nothing from user machines.

### 0.7.2
- README/docs refresh: corrected the Telemetry section (it now describes the default aggregate-only collector instead of the stale "no-op unless configured"), and added sections for the Claude-Code router (`anyclaude-sdk/anthropic-endpoint`), reliable tool use (dialects/profiles/repair), `create-anyclaude-app`, the live compaction marker, and `MessageQueue.remove`. No code changes.

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
