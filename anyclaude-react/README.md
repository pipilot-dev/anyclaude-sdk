# anyclaude-react

Restylable React UI kit for [`anyclaude-sdk`](https://www.npmjs.com/package/anyclaude-sdk) — hooks + components to build chatbots, AI agents, research assistants, and more. Includes built-in **serverless "survivor" stream-stitching** so long agent runs span function time-limits transparently.

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

## Components

| Component | Purpose |
|---|---|
| `<AgentChat>` | All-in-one: Transcript + Working + Composer wired to `useAgent`. |
| `<Transcript messages streamingText>` | Renders messages; pairs tool calls with results. |
| `<Message>` / `<MarkdownMessage>` | Chat bubbles; safe built-in markdown (override via `render`). |
| `<ToolCall>` | Collapsible tool call + result. |
| `<Composer onSend>` | Textarea + send (Enter sends, Shift+Enter newline). |
| `<Working active paused>` | Shimmering "Working…" indicator. |

## Styling

Everything is class-based (`.ac-*`) with `data-role` attributes. Import the
optional `anyclaude-react/styles.css` and override the CSS variables on `.ac-chat`
(`--ac-accent`, `--ac-bg`, `--ac-fg`, …), or skip it and style with your own
CSS / Tailwind. No emojis — icons are inline SVG.
