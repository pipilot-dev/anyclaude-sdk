# anyclaude · browser chat (no backend)

A Vite + React demo where the **[anyclaude-sdk](https://www.npmjs.com/package/anyclaude-sdk) agent
loop runs entirely in the browser tab** — against a keyless LLM endpoint, with no server and no API key.
UI is built with **[anyclaude-react](https://www.npmjs.com/package/anyclaude-react)** (`<AgentChat>`).

## Run

```bash
npm install
npm run dev      # http://localhost:5173
```

## How it works

- **LLM** — `createOpenAIClient({ baseUrl, model })` pointed at the keyless Kilo gateway (kilo-auto/free, ~200 req/hr free)
  (`kilo-auto/free`). Override with env vars (below).
- **Workspace** — an in-browser `MemoryFileSystem` + a no-op shell (file tools work; `bash` is
  unavailable in the tab). No Node built-ins are bundled (imports come from the SDK's
  browser-clean subpaths: `anyclaude-sdk/query`, `/llm`, `/fs`).
- **UI** — `<AgentChat run={...} />` from `anyclaude-react`, where `run` wraps `query()` into the
  message stream the kit consumes. Multi-turn memory via an in-tab `SessionStoreLike`.

## Configure the model (optional)

Create `.env`:

```
VITE_LLM_BASE=https://api.openai.com/v1
VITE_LLM_MODEL=gpt-4o
VITE_LLM_KEY=sk-...
```

## Deploy

```bash
npm run build    # → dist/  (static)
```

It's a fully static site — drop `dist/` on Vercel, Netlify, Cloudflare Pages, GitHub Pages, or
any static host. **No serverless function needed** (the agent runs client-side). Note: a browser
LLM call exposes the key to the client, so only ship a real key for keyless/proxied endpoints.

## Want real code execution?

This minimal example uses an in-memory FS with **no shell** (chat + file edits only). For an agent that actually **runs code in the browser** (real `jsh` shell + Node via WebContainer, plus a terminal / file explorer / editor UI), see [`../browser-ide`](../browser-ide).
