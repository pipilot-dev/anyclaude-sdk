# anyclaude · browser chat (no backend)

A Vite + React demo where the **[anyclaude-sdk](https://www.npmjs.com/package/anyclaude-sdk) agent
loop runs entirely in the browser tab**, with no server.
UI is built with **[anyclaude-react](https://www.npmjs.com/package/anyclaude-react)** (`<AgentChat>`).

> **The LLM endpoint must allow browser CORS** (the loop calls it directly from the
> tab). **Kilo (`api.kilo.ai`) is server-only — no CORS — so set `VITE_LLM_BASE`/
> `VITE_LLM_KEY` to a CORS-enabled provider.** For Kilo, use a server-brain example
> ([`vercel-clienttools`](../vercel-clienttools)).

## Run

```bash
npm install
npm run dev      # http://localhost:5173
```

## How it works

- **LLM** — `createOpenAIClient({ baseUrl, model })`. Point it at a **CORS-enabled**
  OpenAI/Anthropic-compatible endpoint via the env vars below (Kilo is server-only).
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
