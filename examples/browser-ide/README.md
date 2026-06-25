# browser-ide — anyclaude agent + real Node shell, in the browser

A full browser IDE where the **agent loop runs entirely in your tab** against a
keyless LLM, with a **real `jsh` shell + Node.js** via [WebContainer](https://webcontainer.io)
— so the agent can actually write *and run* code. No backend.

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

Optional `.env` (defaults to the keyless Kilo gateway (kilo-auto/free, ~200 req/hr free)): `VITE_LLM_BASE`,
`VITE_LLM_MODEL`, `VITE_LLM_KEY`.
