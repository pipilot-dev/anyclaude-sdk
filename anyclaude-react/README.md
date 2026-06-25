# anyclaude-react

Restylable React UI kit for [`anyclaude-sdk`](https://www.npmjs.com/package/anyclaude-sdk) — hooks + components to build chatbots, AI agents, research assistants, and **browser IDEs**. Includes built-in **serverless "survivor" stream-stitching** (long runs span function time-limits transparently) and **client-side tool execution** (the server-side agent runs `bash`/file tools in the user's browser). Markdown via [`streamdown`](https://www.npmjs.com/package/streamdown).

> **[Live demo](https://anyclaude-docs.puter.site/demo/)** — a full IDE built with this kit, running in your browser.

```bash
npm install anyclaude-react anyclaude-sdk react
```

## Quick start (browser / in-process)

Drive the agent in-process by wrapping the SDK's `query()` in a `run` function:

```tsx
import { AgentChat } from 'anyclaude-react'
import 'anyclaude-react/styles.css'
import { query, createOpenAIClient, MemoryFileSystem, NoopCommandExecutor, composeWorkspace } from 'anyclaude-sdk'

const ws = composeWorkspace(new MemoryFileSystem(), new NoopCommandExecutor(), '/work')
const llm = createOpenAIClient({ baseUrl: '…', model: 'gpt-4o', apiKey: KEY })

export default function App() {
  return (
    <AgentChat
      run={({ prompt, sessionId, continueRun }) =>
        query({ prompt: continueRun ? '' : prompt, workspace: ws, llm, model: 'gpt-4o',
                sessionId, resume: continueRun, continueRun, includePartialMessages: true })}
    />
  )
}
```

## Serverless (survivor)

Point at a function that streams NDJSON `SDKMessage`s. When the function pauses
at its time-limit (`{type:'system',subtype:'paused'}`), the client auto-continues
in a new request with the same `sessionId` — invisibly:

```tsx
<AgentChat endpoint="/api/agent" />
```

Your function runs `query({ ..., maxDurationMs, sessionStore, sessionId, resume: continueRun, continueRun })` and writes each message as a JSON line.

## Hook

```tsx
const { messages, streamingText, status, tokens, cost, send, interrupt, clear } =
  useAgent({ run /* | endpoint | client */, sessionId })
```

- `status`: `'idle' | 'running' | 'paused'`
- `send(text)` starts/continues; `interrupt()` aborts; `clear()` resets (new session).

## Client-side tools (server brain, browser hands)

Run the agent on your server but execute chosen tools in the browser — e.g. `bash` on a WebContainer. Pair `query({ clientTools: ['bash'] })` server-side with a `clientTools` executor map here; `client_tool_request`s are auto-executed and the results streamed back:

```tsx
useAgent({
  endpoint: '/api/agent',
  clientTools: { bash: async ({ command }) => ({ content: await runOnWebContainer(command) }) },
})
```

## Components

**Chat**

| Component | Purpose |
|---|---|
| `<AgentChat>` | All-in-one: Transcript + Working + Composer wired to `useAgent`. |
| `<ChatPanel>` | Like AgentChat with a header (status / tokens / cost). |
| `<Transcript messages streamingText>` | Renders messages; pairs tool calls with results. |
| `<Message>` / `<MarkdownMessage>` | Chat bubbles; markdown via `streamdown` (override via `render`). |
| `<ToolCall>` | Collapsible tool call + result. |
| `<Composer onSend>` | Textarea + send (Enter sends, Shift+Enter newline). |
| `<Working active paused>` | Shimmering "Working…" indicator. |

**IDE** (optional peers: `@xterm/xterm`, `codemirror`)

| Component | Purpose |
|---|---|
| `<Terminal spawn>` | xterm.js bound to a streaming shell (e.g. a WebContainer process). |
| `<FileExplorer list onOpen>` | Collapsible file tree over any filesystem adapter. |
| `<CodeEditor value onChange>` | Controlled CodeMirror 6 editor. |
| `<AskUser question onAnswer>` | Renders an `ask_user_question` prompt; pair with the SDK's `onAskUser`. |

## Styling

Everything is class-based (`.ac-*`) with `data-role` attributes. Import the
optional `anyclaude-react/styles.css` and override the CSS variables on `.ac-chat`
(`--ac-accent`, `--ac-bg`, `--ac-fg`, …), or skip it and style with your own
CSS / Tailwind. No emojis — icons are inline SVG.
