# anyclaude-sdk

[![npm version](https://img.shields.io/npm/v/anyclaude-sdk.svg)](https://www.npmjs.com/package/anyclaude-sdk)
[![anyclaude-react](https://img.shields.io/npm/v/anyclaude-react.svg?label=anyclaude-react)](https://www.npmjs.com/package/anyclaude-react)
[![license](https://img.shields.io/npm/l/anyclaude-sdk.svg)](LICENSE)
[![docs](https://img.shields.io/badge/docs-anyclaude--docs.puter.site-4dd0e1.svg)](https://anyclaude-docs.puter.site)
[![live demo](https://img.shields.io/badge/live%20demo-browser%20IDE-4dd0e1.svg)](https://anyclaude-docs.puter.site/demo/)

Claude Code agent capabilities — tools, the tool loop, multi-turn conversations,
MCP, sub-agents, sessions — against **any OpenAI- or Anthropic-compatible LLM
endpoint**, running in the **browser** ([WebContainer](https://webcontainers.io)),
**Node**, and **Bun**. No backend required, no OAuth, no native binaries.

> **Live demo:** [a full IDE running in your browser](https://anyclaude-docs.puter.site/demo/) ·
> **Docs:** [anyclaude-docs.puter.site](https://anyclaude-docs.puter.site) ·
> **React UI kit:** [`anyclaude-react`](anyclaude-react/)

It exposes the same `query()` async-generator interface and the same `SDKMessage`
envelope as `@anthropic-ai/claude-agent-sdk`, so code written against the official
SDK can iterate our output unchanged.

## Install

```bash
npm install anyclaude-sdk @webcontainer/api
```

`@webcontainer/api` is an optional peer dependency — only needed if you use
`WebContainerWorkspace`. You can supply your own `FileSystem`/`CommandExecutor`.

## Quick start

```typescript
import { WebContainer } from '@webcontainer/api'
import {
  query,
  WebContainerWorkspace,
  createOpenAIClient,
  ALL_CLAUDE_CODE_TOOLS,
} from 'anyclaude-sdk'

// 1. Boot a WebContainer and wrap it as a workspace.
const wc = await WebContainer.boot()
const workspace = new WebContainerWorkspace(wc)

// 2. Point at any OpenAI-compatible endpoint.
const llm = createOpenAIClient({
  apiKey: import.meta.env.VITE_OPENAI_API_KEY,
  baseUrl: 'https://api.openai.com/v1', // or Groq, Together, OpenRouter, local…
  model: 'gpt-4o',
})

// 3. Run the agent — same shape as the official SDK.
for await (const msg of query({ prompt: 'List the files and summarize the project', workspace, llm })) {
  if (msg.type === 'assistant') {
    for (const block of msg.message.content) {
      if (block.type === 'text') console.log(block.text)
    }
  } else if (msg.type === 'result' && msg.subtype === 'success') {
    console.log('Done:', msg.result)
  }
}
```

### MCP servers (external + in-process)

Connect external MCP servers or define in-process tools. Because browsers block
direct cross-origin MCP fetches (CORS), pass a `mcpProxy` for remote servers:

```typescript
import { createSdkMcpServer, tool } from 'anyclaude-sdk'

const calc = createSdkMcpServer({
  name: 'calc',
  tools: [tool('add', 'Add two numbers',
    { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] },
    (args) => ({ content: [{ type: 'text', text: String(args.a + args.b) }] }))],
})

query({
  prompt, workspace, llm,
  mcpServers: {
    calc,                                                   // in-process, no network
    docs: { type: 'http', url: 'https://mcp.example.com' }, // remote
  },
  // Route remote MCP through a CORS proxy (function, `{url}`/`{rawUrl}` template, or bare prefix):
  mcpProxy: 'https://my-proxy.example/?url={url}',
})
```

Remote tools are exposed as `mcp__<server>__<tool>`.

### Providers

Three transport clients, all implementing the same `LLMClient` interface:

```typescript
import { createOpenAIClient, createAnthropicClient, createResponsesClient } from 'anyclaude-sdk'

// OpenAI-compatible Chat Completions (OpenAI, Groq, Together, OpenRouter, xAI, Kilo, local…)
const a = createOpenAIClient({ apiKey, baseUrl: 'https://api.x.ai/v1', model: 'grok-build-0.1' })

// Anthropic Messages API
const b = createAnthropicClient({ apiKey, model: 'claude-sonnet-4-6' })

// OpenAI Responses API (POST /v1/responses)
const c = createResponsesClient({ apiKey, model: 'gpt-4o' })
```

All three normalize tool calls, streaming, and usage to the same `StreamResult`,
and include a fallback parser for models that emit tool calls as inline text.

## Multi-turn / interactive sessions

Use a `PromptStream` to push user turns over time:

```typescript
import { query, PromptStream } from 'anyclaude-sdk'

const prompts = new PromptStream()
const session = query({ prompt: prompts, workspace, llm, model: 'gpt-4o' })

prompts.push('Create a hello.txt with a greeting')
// …later, based on UI input:
prompts.push('Now translate it to French')
prompts.end() // close the conversation

for await (const msg of session) {
  // render msg…
}
```

## Tools

`ALL_CLAUDE_CODE_TOOLS` includes:

| Tool | Purpose |
|------|---------|
| `bash` | Run shell commands via jsh (`2>&1`/`/dev/null` redirects are stripped) |
| `read_file` | Read text (numbered lines, offset/limit), **images** (auto-downsampled base64), **PDFs** (document block), and **notebooks** (`.ipynb` cells + outputs); binary files are rejected with guidance |
| `write_file` | Write a file, creating parent dirs |
| `edit_file` | Exact-match string replace (requires a prior read) |
| `multi_edit` | Apply a sequence of edits to one file atomically |
| `notebook_edit` | Replace/insert/delete cells in a `.ipynb` |
| `delete_file` | Remove a file/dir |
| `glob` | Find files by glob pattern (`**`, `*`, `?`) |
| `grep` | Regex search across files |
| `list_files` | List a directory |
| `todo_write` | Track a multi-step task list across turns |
| `web_fetch` | Fetch a URL → clean Markdown via the Jina Reader (CORS-free, JS-rendered) |
| `web_search` | Web search via Jina + DuckDuckGo HTML; returns top-N title/URL/snippet |

### File reading: images, PDFs, notebooks

`read_file` dispatches by file type. Image and PDF bytes are forwarded to the
model automatically as a follow-up user turn (Anthropic gets native
`image`/`document` blocks; OpenAI-compatible endpoints get `image_url`/`file`
parts), so the model can actually *see* the file, not just a text summary.
Tune the caps via `limits`:

```typescript
query({ prompt, workspace, llm, limits: { maxTokens: 25000, maxImageBytes: 3_750_000, maxPdfPages: 20 } })
```

Pass a subset, or your own `Tool[]`, via `tools:`:

```typescript
import { readFile, writeFile, editFile } from 'anyclaude-sdk'

query({ prompt, workspace, llm, tools: [readFile, writeFile, editFile] })
```

## Slash commands

A user turn beginning with `/` is intercepted. Built-ins: `/help`, `/clear`,
`/compact [focus]` (summarizes history to free context), `/tools`, `/cost`,
`/model`. Define your own prompt-template commands:

```typescript
import { query, promptCommand } from 'anyclaude-sdk'

query({
  prompt: promptStream, workspace, llm,
  commands: [promptCommand('review', 'Review the diff', 'Review this code and list issues: $ARGUMENTS')],
})
// user types: /review src/app.ts
```

## Background tasks

Enable with `background: true` to run sub-agents or long work off the critical
path. The `task` tool gains `run_in_background` (returns a task id immediately),
and `task_list` / `task_output` / `task_stop` tools let the agent poll them.
Optional off-main-thread execution via a Comlink worker harness
(`exposeBackgroundWorker` / `wrapWorker`); the in-thread manager works without it.

```typescript
query({ prompt, workspace, llm, agents: {}, background: true })
```

### Agents in separate Web Workers

Two halves: **Comlink** for main→worker control (`wrapWorker` / `exposeBackgroundWorker`,
above), and **`BroadcastChannelMailbox`** so agents in *different* workers gossip
mailbox-style. It's a drop-in `Mailbox`, so the existing `team` tools
(`send_message` / `dispatch_tasks`) work unchanged across workers:

```typescript
import { BroadcastChannelMailbox } from 'anyclaude-sdk'

// inside each Web Worker / tab / worker_thread, same channel name:
const mailbox = new BroadcastChannelMailbox({ channelName: 'team', origin: 'planner' })
query({ prompt, workspace, llm, team: true, mailbox })
// messages sent by one worker land in the addressed agent's inbox in another.
```

Uses the global `BroadcastChannel` by default; pass `{ channel }` (e.g. the
[`broadcast-channel`](https://www.npmjs.com/package/broadcast-channel) package)
for cross-tab durability or older runtimes.

## Pluggable backends

You aren't tied to WebContainer. A `Sandbox` is just a `FileSystem` plus a
`CommandExecutor`, and you can mix and match.

### Any sandbox provider

Adapters wrap each provider's client structurally (no hard dependency on their
SDKs — install only the one you use):

```typescript
import { E2BSandbox, VercelSandbox, DaytonaSandbox, CloudflareSandbox } from 'anyclaude-sdk'

// e.g. E2B
import { Sandbox } from 'e2b'
const sbx = await Sandbox.create()
const workspace = new E2BSandbox(sbx)

query({ prompt, workspace, llm })
```

Supported: **WebContainer**, **E2B**, **Vercel Sandbox**, **Daytona**,
**Cloudflare Sandbox**, and **LocalSandbox** (real OS). All implement the same
`Sandbox` interface.

### Local real-OS sandbox (Node)

Run the agent directly against the host machine's filesystem and shell — like
Claude Code — with automatic platform detection (Windows / macOS / Linux):

```typescript
import { LocalSandbox, createAnthropicClient, query } from 'anyclaude-sdk'

const workspace = new LocalSandbox({ cwd: '/path/to/project' }) // defaults to process.cwd()
const llm = createAnthropicClient({ baseUrl, model: 'claude-sonnet-4-6', apiKey })

for await (const msg of query({ prompt: 'add a CLI flag and run the tests', workspace, llm })) { /* … */ }
```

The agent's working directory is taken from the sandbox automatically. See
`examples/local-agent.mjs` for a runnable headless demo. On Windows it uses
`cmd.exe`; elsewhere `$SHELL`/`/bin/sh` (override via `shell`/`shellArgs`).

### Persistent, full Linux-style filesystem (no server)

For a durable local filesystem in the browser, use a DB-backed FS and seed a
standard Linux tree. `DexieFileSystem` (IndexedDB) is the recommended default
— persistent across reloads, indexed for fast `readdir`/`glob`, with metadata
(mode, mtime, symlinks):

```typescript
import {
  DexieFileSystem, OpfsFileSystem, seedLinuxTree, composeWorkspace, NoopCommandExecutor,
} from 'anyclaude-sdk'

const fs = new DexieFileSystem('my-project-fs')   // or: new OpfsFileSystem()
await seedLinuxTree(fs)                            // /bin /etc /home/user /tmp /usr …

// File-only agent (no shell):
const workspace = composeWorkspace(fs, new NoopCommandExecutor(), '/home/user')

// …or pair a persistent FS with a remote shell:
// const workspace = composeWorkspace(fs, new E2BSandbox(sbx), '/home/user')
```

`OpfsFileSystem` (Origin Private File System) is offered alongside Dexie for
large-binary / native-handle scenarios; use `OpfsFileSystem.isSupported()` to
feature-detect.

A `MemoryFileSystem` also ships for tests:

```typescript
import { MemoryFileSystem, NoopCommandExecutor, composeWorkspace } from 'anyclaude-sdk'

const fs = new MemoryFileSystem()
await fs.writeFile('/app/index.ts', 'export const x = 1')
const workspace = composeWorkspace(fs, new NoopCommandExecutor())
```

## Skills (programmatic)

Declare reusable prompt-skills inline — each becomes a `/name` slash command and is invokable by the agent through the `skill` tool. `$ARGUMENTS` is substituted at call time:

```ts
import { query, defineSkill } from 'anyclaude-sdk'

query({
  prompt, workspace, llm,
  skills: [
    defineSkill({
      name: 'changelog',
      description: 'Summarize git changes into a changelog entry',
      instructions: 'Write a concise changelog entry for: $ARGUMENTS',
      argumentHint: '<since>',
    }),
  ],
})
```

You can also pass plain `Skill` objects, or `skills: true` to load `.claude/skills/*.md` from the workspace.

## Serverless & the "survivor"

Run `query()` in a serverless function and stream `SDKMessage`s to the browser. For runs longer than the platform's time cap, checkpoint at a turn boundary and continue transparently in a fresh invocation:

```ts
// pause near the deadline, persist to the store, emit a `paused` message
query({ prompt, workspace, llm, sessionStore, maxDurationMs: 20_000 })
// later — resume + continue the tool loop with NO new user message
query({ workspace, llm, sessionStore, resume: true, continueRun: true })
```

Pluggable `SessionStore` adapters (all implement `SessionStoreLike`): `SessionStore` (IndexedDB), `MemorySessionStore`, `KVSessionStore` (Vercel KV / Upstash), `RedisSessionStore`, `PostgresSessionStore` (Neon / pg / postgres.js), `SupabaseSessionStore`.

## Client-side tools — server brain, browser hands

Declare tools the **host** executes — e.g. run `bash` in the user's browser WebContainer while the agent loop runs on your server. The run pauses with a `client_tool_request`; the client executes it and you resume with the result:

```ts
import { WORKSPACE_TOOL_NAMES } from 'anyclaude-sdk'
query({ prompt, llm, workspace, sessionId, clientTools: WORKSPACE_TOOL_NAMES })  // → emits client_tool_request + pauses
query({ llm, workspace, sessionId, resume: true, continueRun: true, clientToolResults })  // → continues
```

On the browser side, `anyclaude-react` turns those into a ready executor map backed by **any** workspace — a WebContainer (real shell + files), the user's **IndexedDB** (`DexieFileSystem`), OPFS, or memory:

```tsx
import { createWebContainerClientTools, createWorkspaceClientTools } from 'anyclaude-react'
useAgent({ endpoint: '/api/agent', clientTools: createWebContainerClientTools(wc) })           // files + bash
useAgent({ endpoint: '/api/agent', clientTools: createWorkspaceClientTools(new DexieFileSystem('my-db')) }) // IndexedDB
```

## Interactive — `ask_user_question`

Provide `onAskUser` and the agent gains an `ask_user_question` tool to put a multiple-choice decision to the user:

```ts
query({ prompt, workspace, llm, onAskUser: async ({ question, options }) => pickOne(question, options) })
```

## Hiding your prompt from the browser (projection)

The agent loop runs server-side, so your system prompt, tool instructions, and retrieved context live in the server→LLM request and **never reach the browser**. To also strip sensitive artifacts (reasoning, raw tool output / RAG, model identity) from the streamed messages, wrap the stream — a pure, opt-in output transform:

```ts
import { projectMessages } from 'anyclaude-sdk'
for await (const m of projectMessages(query({ /* ... */ }), { preset: 'public' }))
  res.write(JSON.stringify(m) + '\n')
```

`paused` and `client_tool_request` control messages are always preserved. (Note: anything that *runs in the browser* — `createAgentClient` mode — necessarily exposes its request; use the server/endpoint path when the prompt is proprietary.)

## React UI kit — `anyclaude-react`

```bash
npm install anyclaude-react
```

`useAgent()` plus restylable components — chat (`AgentChat`, `ChatPanel`, `Transcript`, `MarkdownMessage`, `Composer`, `Working`, `ToolCall`) and an IDE set (`Terminal`, `FileExplorer`, `CodeEditor`, `AskUser`). `createAgentClient` / `createEndpointClient` auto-stitch `paused` continuations and run `clientTools` in the browser.

## Run Claude Code against any model — `anyclaude-sdk/anthropic-endpoint`

Stand up an Anthropic Messages API-compatible endpoint backed by any OpenAI-compatible model, so **Claude Code itself** (or any Anthropic-Messages client) runs against DeepSeek / Qwen / GLM / Kimi / local Ollama. Unlike a naive proxy, inline tool-call **dialects are recovered into proper `tool_use` blocks**, so tool use actually works on cheap models.

```ts
import { createOpenAIClient } from 'anyclaude-sdk/llm'
import { anthropicToChat, anthropicSSE } from 'anyclaude-sdk/anthropic-endpoint'

const llm = createOpenAIClient({ baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey })
// POST /v1/messages:
for await (const evt of anthropicSSE(llm, anthropicToChat(body), { model: 'deepseek-chat' })) res.write(evt)
// then: ANTHROPIC_BASE_URL=http://localhost:8787 claude
```

Runnable: [`examples/claude-code-router`](examples/claude-code-router).

## Reliable tool use on cheap / open models

Frontier models emit clean native function-calls; cheaper ones often don't. Three layers (in `anyclaude-sdk/llm`) close the gap: **tool-call dialects** (`parseToolCalls` — xml-function / hermes / json-fence), **auto-detected model profiles** (`profileForModel` — qwen/deepseek/moonshot/zhipu/mistral/llama), and **self-healing argument repair** (`query({ repairToolCalls })`, on by default — validates args and feeds the model a corrective tool_result instead of running with garbage). Prove it on your endpoints with [`scripts/compat-matrix.mjs`](scripts/compat-matrix.mjs) → [COMPATIBILITY.md](COMPATIBILITY.md).

## Scaffold an in-browser AI IDE

```bash
npm create anyclaude-app@latest my-app   # template: bolt — WebContainer + chat + live preview, no backend
```

The `bolt` template wires `useWebContainerPreview({ wc })` (boot a dev server → live preview URL) + a browser-side `query()` + the IDE components. See [`anyclaude-react`](#react-ui-kit--anyclaude-react).

## Token efficiency — deferred tools

Keep a large pool of rarely-used tools **out of the per-turn payload** (big savings on weak/uncached models) while staying discoverable + callable. Mark them deferred; `tool_search` indexes them and the loop **arms** a tool (sends its schema on subsequent turns) once search surfaces it — then it executes normally.

```ts
query({ prompt, workspace, llm,
  extraTools: [deploy, ...integrationTools],   // e.g. 35 integration tools
  deferredTools: ['stripe_charge', 'supabase_query', /* … the niche ones */],
})
// or per-tool: defineTool({ name, description, parameters, run, defer: true })
```

Only the lean core + `tool_search` are sent each turn; the model searches when it needs a niche tool, the SDK arms it, and the call goes through. Register 35, send ~10.

## Agent-loop tuning (cheap / lightweight / fast)

Opt-in knobs for token cost and latency — especially on weak / uncached models:

```ts
query({
  prompt, workspace, llm,
  systemPromptPreset: 'lean',      // ~70% shorter built-in prompt — saved every turn on uncached models
  keepToolResults: 6,              // context editing: stub tool_results older than the last 6 (caps transcript growth)
  parallelToolExecution: true,     // run a turn's read-only tool calls concurrently (~2× faster on multi-read turns)
  deferredTools: [/* niche tools */], // keep rarely-used tools out of the payload until tool_search arms them
})
// custom read tool opting into parallelism:
defineTool({ name: 'get_logs', description: '…', parameters, run, parallelSafe: true })
```

Mutating tools / `bash` / delegated client tools always execute serially; `keepToolResults` and `parallelToolExecution` preserve correctness, just trim cost/latency.

## Other niceties

- **Live compaction marker** — `autoCompact` emits a `compact_boundary` with `status: 'start'` *before* summarizing (for a live "compacting…" shimmer) and `status: 'end'` after with `post_tokens`.
- **Cancel a queued message** — `MessageQueue.push()` returns a stable id; `remove(id)` cancels a single pending message (per-pill ✕ in a UI).
- **BYO LLM client** — reuse the SDK's wire codec: `toOpenAIMessages`, `consumeSSE`, and the LLM types from `anyclaude-sdk/llm` (no bare-root import in browser bundles).

## Examples & live demo

Runnable Vite projects in [`examples/`](examples/): **`browser-ide`** (WebContainer IDE — real shell + Node in the tab), `browser-chat`, `claude-code-router`, `vercel-kv-survivor`, `vercel-supabase-survivor`, `vercel-indexeddb-survivor`, **`vercel-clienttools`** (server brain / browser hands). Try the **[live demo](https://anyclaude-docs.puter.site/demo/)**.

## API

- `query(options): AsyncGenerator<SDKMessage>` — main entry.
  - `prompt: string | AsyncIterable<SDKUserMessage>`
  - `workspace: FileSystem & CommandExecutor`
  - `llm: LLMClient`
  - `tools?`, `extraTools?`, `allowedTools?`/`disallowedTools?`, `deferredTools?` (lazy-load), `model?`, `systemPrompt?`/`appendSystemPrompt?`, `maxTurns?` (default 50), `cwd?`, `abortController?`
  - serverless: `sessionStore?`, `resume?`, `maxDurationMs?`, `continueRun?`
  - client tools: `clientTools?`, `clientToolResults?`; interactive: `onAskUser?`
  - also: `mcpServers?`, `agents?`, `commands?`, `hooks?`, `background?`, `team?`, `memory?`, `permissionMode?`/`canUseTool?`, `messageQueue?`
- `createOpenAIClient` / `createAnthropicClient` / `createResponsesClient`
- `WebContainerWorkspace`, `MemoryFileSystem`, `NoopCommandExecutor`, `LocalSandbox`, `composeWorkspace`
- `defineTool` (custom tools), `projectMessages` (server-side stream redaction)
- `ALL_CLAUDE_CODE_TOOLS`, individual tools, `toolDefs`, `toolByName`
- browser-clean subpaths: `anyclaude-sdk/{query,loop,llm,fs,workspace,tools,session,memory,compact,permissions,skills,queue,prompt,anthropic-endpoint,telemetry}`
- `anyclaude-sdk/llm`: `parseToolCalls` + dialects, `profileForModel` (model profiles), `validateToolArguments` (repair), `toOpenAIMessages` / `consumeSSE` (BYO-client codec)
- `anyclaude-sdk/anthropic-endpoint`: `anthropicToChat`, `anthropicSSE`, `streamResultToAnthropicMessage` (Claude-Code router)
- `runToolLoop` (`/loop`), `compactWithWindow` (`/compact`), `track`/`telemetryEnabled` (`/telemetry`)
- All `SDK*` message types, `ContentBlockParam`, `LLMClient`, `ToolDef`, `SessionStoreLike`, etc.

## Differences from the official SDK

| Feature | Official SDK | anyclaude-sdk |
|---------|-------------|--------------------|
| Auth | OAuth token | None required |
| Backend | claude.ai API | Any OpenAI/Anthropic endpoint |
| Runtime | Node only | Browser, Node, Bun |
| File ops | Native filesystem | Pluggable (WebContainer / Memory / IndexedDB / local) |
| Commands | Native shell | jsh (WebContainer) / local / client-side tools |
| MCP / slash commands / background tasks / sub-agents | Built-in | Built-in |
| Serverless survivor + prompt projection | — | Built-in |

## Telemetry

The SDK emits **anonymous, opt-out** usage telemetry (SDK version, runtime, a coarse model-family bucket, and which features are used) — never code, prompts, repo identity, paths, or keys. It sends to an aggregate-only collector (a Puter Worker; source in [`examples/telemetry-collector`](examples/telemetry-collector)). Disable with `ANYCLAUDE_TELEMETRY=0`, `DO_NOT_TRACK=1`, or `query({ disableTelemetry: true })`; repoint with `ANYCLAUDE_TELEMETRY_URL` (or set it to `''` to send nowhere). Full disclosure: [TELEMETRY.md](TELEMETRY.md).

## License

MIT
