# anyclaude-sdk

Claude Code agent capabilities — tools, the tool loop, multi-turn conversations —
running **entirely in the browser** via [WebContainer](https://webcontainers.io),
against **any OpenAI- or Anthropic-compatible LLM endpoint**. No backend, no OAuth,
no native binaries.

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

## API

- `query(options): AsyncGenerator<SDKMessage>` — main entry.
  - `prompt: string | AsyncIterable<SDKUserMessage>`
  - `workspace: FileSystem & CommandExecutor`
  - `llm: LLMClient`
  - `tools?`, `model?`, `systemPrompt?`, `maxTurns?` (default 50), `cwd?`, `abortController?`
- `createOpenAIClient(options): LLMClient`
- `createAnthropicClient(options): LLMClient`
- `WebContainerWorkspace`, `MemoryFileSystem`, `NoopCommandExecutor`
- `ALL_CLAUDE_CODE_TOOLS`, individual tools, `toolDefs`, `toolByName`
- All `SDK*` message types, `ContentBlockParam`, `LLMClient`, `ToolDef`, etc.

## Differences from the official SDK

| Feature | Official SDK | anyclaude-sdk |
|---------|-------------|--------------------|
| Auth | OAuth token | None required |
| Backend | claude.ai API | Any OpenAI/Anthropic endpoint |
| File ops | Native filesystem | WebContainer fs (pluggable) |
| Commands | Native shell | jsh (WebContainer) |
| MCP / slash commands / background tasks | Built-in | Not included |

## License

MIT
