# anyclaude — IndexedDB + stateless serverless survivor

A Vite + React app on Vercel that runs long agents on a **free serverless tier with no database** — the durable session store is the **browser's IndexedDB**, and the Vercel function is **completely stateless**.

## How the survivor works here

Most serverless functions die at a time cap (Vercel Hobby ~300s, Appwrite 30s, Netlify ~10s). anyclaude-sdk's "survivor" pauses the agent loop at a turn boundary (`maxDurationMs`), persists the transcript, and lets a fresh invocation `resume` + `continueRun`. Usually you'd persist server-side (KV/Postgres/Supabase). **This example needs no server DB at all** — the transcript travels with the request:

1. **Browser → function**: load the transcript for this `sessionId` from IndexedDB (SDK's Dexie `SessionStore`) and POST `{ prompt, transcript, sessionId, continueRun }`.
2. **Function (stateless)**: hydrate a `MemorySessionStore` from the posted transcript, run `query({ … maxDurationMs })`, stream every `SDKMessage` as NDJSON, then emit a final `{ subtype: 'session_snapshot', transcript }`.
3. **Browser**: render the stream; on `session_snapshot`, save the updated transcript back to IndexedDB. If a `{ subtype: 'paused' }` was seen, **re-POST the freshly saved transcript with `continueRun: true`** and keep going until the run completes.

The pause is invisible to the user; the server holds zero state between requests.

**Tradeoff:** the transcript is sent on every request (grows with the conversation), so this suits short-to-medium agents / free tiers without a DB. For very long transcripts, use a server-side store (`KVSessionStore` / `SupabaseSessionStore` / `PostgresSessionStore`) instead — see the sibling examples.

## Run

```bash
npm install
cp .env.example .env        # defaults to the keyless the3rdacademy endpoint
vercel dev                  # serves the Vite app + /api/agent together
# or just the frontend (no function): npm run dev
```

The default `MAX_DURATION_MS=20000` makes the survivor trigger quickly so you can watch the "paused → continuing" handoff. Raise it toward your platform's cap in production.

## Deploy

```bash
vercel            # set LLM_* + MAX_DURATION_MS in the Vercel project env
```

## Files

- `api/agent.ts` — stateless function: hydrate `MemorySessionStore` from the posted transcript, run the loop under a budget, stream NDJSON, emit a snapshot.
- `src/agentClient.ts` — browser client: IndexedDB transcript + the POST/stream/snapshot/continue loop.
- `src/App.tsx` — chat UI with a running/paused status badge.
