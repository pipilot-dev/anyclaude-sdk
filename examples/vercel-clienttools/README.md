# anyclaude — Vercel client-tools (server brain, browser hands)

The agent loop runs on a **Vercel serverless function**, but its `bash`,
`write_file`, `read_file`, `edit_file` and `list_files` tools are **client
tools**: the server declares them and *calls* them, but executes nothing. Each
call is shipped to the browser, run on a real **WebContainer** (a Linux-ish
`jsh` shell + filesystem in your tab), and the result is fed back to the server,
which resumes the loop.

This is the right architecture when you want a private LLM key on the server but
real, sandboxed execution in the user's browser — no code runs on your backend.

```
 browser                         vercel function (api/agent.ts)
 ┌──────────────┐   POST /api/agent ┌───────────────────────────┐
 │ useAgent({   │ ───────────────▶  │ query({ clientTools:[bash, │
 │  endpoint,   │                   │   write_file, ... ] })     │
 │  clientTools })                  │  model calls bash          │
 │              │ ◀─ client_tool_   │  → pause + persist to KV   │
 │ run on       │     request ───── │                            │
 │ WebContainer │                   │                            │
 │              │ ── clientToolResults + continueRun ──▶ resume  │
 └──────────────┘                   └───────────────────────────┘
```

## How it works

- **Server** (`api/agent.ts`): `query({ clientTools: ['bash', ...] })`. Listed
  tools are never executed server-side — the loop records the call, pauses at the
  turn boundary, persists the transcript to **Vercel KV**, and streams a
  `system/client_tool_request` (+ survivor `system/paused`) message.
- **Browser** (`src/App.tsx`): `useAgent({ endpoint: '/api/agent', clientTools })`.
  The `clientTools` map (`src/webcontainerTools.ts`) executes each request on the
  booted WebContainer, then anyclaude-react automatically re-POSTs with
  `clientToolResults` + `continueRun: true`. The same container backs the visible
  terminal — so you watch the server's agent operate your browser.

The pause/resume round-trip rides the same **survivor** machinery that lets a run
span the function time cap.

## Run locally

```bash
npm install
cp .env.example .env            # set LLM_KEY (+ KV creds, or `vercel env pull`)
vercel dev                      # serves the frontend AND api/ with COOP/COEP
```

> Plain `vite` won't serve `api/`. Use `vercel dev` (or `vercel dev --listen 3000`
> behind the vite proxy) so `/api/agent` resolves. WebContainer requires the
> cross-origin-isolation headers already set in `vite.config.ts` / `vercel.json`.

## Deploy

```bash
vercel
```

Attach a **KV** store to the project (Storage → KV) so `KV_REST_API_*` are
injected, and set `LLM_KEY` (and optionally `LLM_BASE` / `LLM_MODEL`) in the
project env. The COOP/COEP headers in `vercel.json` are required for WebContainer.

## Verify the build

```bash
npm run build          # vite build (frontend)
npm run check:api      # tsc -p tsconfig.api.json --noEmit (the function)
```
