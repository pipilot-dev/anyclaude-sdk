# anyclaude-sdk — Vercel serverless + KV "survivor"

A Vite + React chat where the agent loop runs in a **Vercel serverless function**
and the **survivor** lets a single run span the function's time cap: when the
budget is hit it persists the transcript to **Vercel KV**, emits a `paused`
message, and the browser client transparently continues it in a new request.

- Frontend: `anyclaude-react` `useAgent({ endpoint: '/api/agent' })` — its endpoint
  client auto-stitches `paused` → `continueRun` (same `sessionId`).
- Function: `api/agent.ts` runs `query({ …, maxDurationMs, sessionStore: new KVSessionStore(kv) })`
  and streams `SDKMessage`s as NDJSON.

## Setup

```bash
npm install

# 1) Create a Vercel KV store (dashboard → Storage → KV) and link it to the project.
# 2) Pull its env vars locally:
vercel env pull .env          # populates KV_REST_API_URL / KV_REST_API_TOKEN
#    (or copy .env.example → .env and fill them in)

# Run frontend + function together:
vercel dev
```

LLM defaults to the Kilo gateway (kilo-auto/free; requires an LLM key) endpoint — set `LLM_BASE` / `LLM_MODEL`
/ `LLM_KEY` in `.env` to use OpenAI, xAI, Ollama, etc.

## See the survivor work

Set a small budget so it triggers on demand:

```bash
echo "MAX_DURATION_MS=3000" >> .env
```

Ask the agent to do something multi-step. After ~3s the status flips to
**paused — continuing in a new request…**, the function returns, the client fires
a continuation (resuming from KV), and the stream picks up where it left off —
seamlessly. In production leave `MAX_DURATION_MS` just under your plan's cap
(Vercel Hobby ≈ 300s).

## Deploy

```bash
vercel        # preview
vercel --prod # production
```

The frontend builds to `dist/` (static) and `api/agent.ts` deploys as a function
(`maxDuration` in `vercel.json`). KV persistence makes the survivor work across
the cold, independent invocations a continuation produces.

## Build check

```bash
npm run build      # Vite frontend → dist/
npm run check:api  # type-check api/agent.ts
```
