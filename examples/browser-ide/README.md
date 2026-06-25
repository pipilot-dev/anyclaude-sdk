# browser-ide — anyclaude agent + real Node shell, in the browser

A full browser IDE where the **agent loop runs entirely in your tab**, with a
**real `jsh` shell + Node.js** via [WebContainer](https://webcontainer.io) — so the
agent can actually write *and run* code. No backend.

> **LLM endpoint must allow browser CORS.** Because the loop runs in the tab, it
> calls the LLM directly from the browser — so the endpoint needs
> `Access-Control-Allow-Origin`. **Kilo (`api.kilo.ai`) is server-only (no CORS)
> and won't work here** — set `VITE_LLM_BASE`/`VITE_LLM_KEY` to a CORS-enabled
> provider. To use Kilo with in-browser execution, use the server-brain
> [`vercel-clienttools`](../vercel-clienttools) example instead (LLM runs on the
> server; tools run in the browser).

Components from `anyclaude-react`: `<FileExplorer>`, `<CodeEditor>`, `<Terminal>`,
`<ChatPanel>` (+ `<AskUser>` for the agent's `ask_user_question` tool).

## Why WebContainer (and not a no-op shell)

A `MemoryFileSystem` with a stub `exec` makes `bash` fail (exit 127) and the agent
keeps trying to run things it can't. WebContainer boots a real POSIX-ish `jsh`
with **Node + npm** (no Python), so `bash` works and the agent runs Node code.
The system prompt tells the agent exactly that.

## Run

```bash
npm install
npm run dev      # open the printed URL
```

> Needs **cross-origin isolation** (SharedArrayBuffer). `vite.config.ts` sets the
> `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`
> headers for dev/preview; `vercel.json` sets them for deploy.

## Deploy (Vercel / any static host)

```bash
npm run build    # → dist/  (static)
vercel deploy    # vercel.json applies the COOP/COEP headers
```

Set `.env` to a **CORS-enabled** OpenAI/Anthropic-compatible endpoint —
`VITE_LLM_BASE`, `VITE_LLM_MODEL`, `VITE_LLM_KEY`. (Kilo is server-only, so it
isn't a working default here — see the CORS note above.)
