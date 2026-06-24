# anyclaude — Vercel + Supabase "survivor" example

A Vite + React chat app whose agent loop runs in a **Vercel serverless function**
(`api/agent.ts`) and **survives the function's time cap** by checkpointing to
**Supabase** and transparently continuing in a new invocation.

How it works:
- The function runs `query({ ..., sessionStore: new SupabaseSessionStore(supabase), maxDurationMs })`.
- At a turn boundary past `MAX_DURATION_MS` it persists the transcript to Supabase and emits a `paused` message.
- The frontend's `useAgent({ endpoint: '/api/agent' })` (anyclaude-react) sees `paused` and **auto-fires a continuation** (`resume` + `continueRun`, same `sessionId`), stitching everything into one seamless stream. The status bar shows `⟳ continuing` when it survives a pause.

`MAX_DURATION_MS` defaults to **20s** so the survivor visibly triggers in a demo — raise it toward your plan's cap (Vercel Hobby ~300s) for production.

## Setup

1. **Supabase**: create a project, open the SQL editor, run [`supabase-schema.sql`](./supabase-schema.sql).
2. **Env**: copy `.env.example` → `.env.local` and set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (service-role key — server-side only, never exposed to the browser). `LLM_*` defaults to the keyless the3rdacademy endpoint; set your own to use another provider.
3. **Install**: `npm install`

## Run / deploy

- **Local (full, incl. the function):** `npx vercel dev` → http://localhost:3000
- **Frontend only:** `npm run dev` (the `/api/agent` call needs `vercel dev`)
- **Deploy:** `npx vercel` (set the same env vars in the Vercel dashboard / `vercel env`)
- **Build:** `npm run build` (frontend) · `npm run typecheck:api` (function)

## Files
- `api/agent.ts` — the serverless agent + survivor + Supabase store
- `src/App.tsx` — `useAgent({ endpoint })` UI with a live status badge
- `supabase-schema.sql` — the `sessions` table
