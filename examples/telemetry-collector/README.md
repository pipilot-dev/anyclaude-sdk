# anyclaude-sdk telemetry collector

A tiny, portable [`fetch`](./worker.mjs) handler that receives the SDK's **anonymous** usage events and keeps **aggregate counters** — never raw payloads, never anything identifying. Use it to answer "how many runs, on which runtimes, using which features" without collecting who.

It re-validates every event against a strict allowlist on the server side too (defence in depth), so even a malformed or tampered payload can only ever increment a known counter.

## Endpoints
- `POST /` — record one event → `204`
- `GET /` — aggregate counters as JSON (e.g. `{ "event:run": 1240, "runtime:node": 800, "feature:survivor": 130, "model_family:deepseek": 410 }`)

## Deploy

**Cloudflare Workers** (persistent counts via KV):
```bash
# wrangler.toml: bind a KV namespace named TELEMETRY
npx wrangler kv namespace create TELEMETRY
npx wrangler deploy worker.mjs
```

**Vercel Edge / Deno Deploy / Bun** — the default export is a standard Web `fetch` handler; wrap it per platform (e.g. `Bun.serve({ fetch: (req) => worker.fetch(req, {}) })`). Without a KV binding it accepts events and returns zeros on `GET` — fine for a smoke test; add storage for real counts.

**Puter Worker** — deploy `worker.mjs` as a Puter Worker and use its URL.

## Wire the SDK to it
```bash
# Node
ANYCLAUDE_TELEMETRY_URL=https://your-collector.example.com/ node app.js
```
```ts
// or per call
query({ /* … */, telemetry: { url: 'https://your-collector.example.com/' } })
```

## What it accepts (and nothing else)
- `event` (only `"run"`), `sdk_version`, `runtime` (browser/node/bun/webcontainer)
- `model_family` (coarse bucket: openai/anthropic/qwen/deepseek/…)
- boolean feature flags: `client_workspace_tools`, `client_tools`, `survivor`, `mcp`, `team`, `background`, `auto_compact`, `skills`, `sessions`, `partial_messages`, `resumed`

The SDK never sends — and this collector would discard — repo URLs, project names, file paths, source, prompts, messages, tool args, LLM responses, API keys, or endpoints. See [`TELEMETRY.md`](../../TELEMETRY.md).
