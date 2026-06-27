// Minimal anonymous-telemetry collector for anyclaude-sdk.
//
// A portable Web `fetch` handler — runs on Cloudflare Workers, Vercel Edge, Deno
// Deploy, Bun.serve, or a Puter Worker. It accepts the SDK's anonymous events,
// validates them against a strict allowlist (drops anything identifying), and
// keeps AGGREGATE counters only. It never stores raw payloads.
//
// Bind a KV namespace as `env.TELEMETRY` for persistent counts; without it the
// worker still accepts events (and returns zeros on GET) so it's safe to deploy
// before wiring storage.
//
//   POST /   → record one event (204)
//   GET  /   → aggregate counters (JSON)
//
// Point the SDK at it:  ANYCLAUDE_TELEMETRY_URL=https://your-collector/  (or query({ telemetry: { url } }))

// Only these fields are ever read off an event; everything else is ignored.
const ALLOWED_EVENTS = new Set(['run', 'run_end'])
const STRING_FIELDS = { runtime: 12, sdk_version: 16, model_family: 24, tokens_bucket: 10 }
const BOOL_FIELDS = [
  'client_workspace_tools', 'client_tools', 'survivor', 'mcp', 'team',
  'background', 'auto_compact', 'skills', 'sessions', 'partial_messages', 'resumed',
]

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
}

async function bump(kv, keys) {
  if (!kv) return
  await Promise.all(
    keys.map(async (k) => {
      const cur = parseInt((await kv.get(k)) || '0', 10) || 0
      await kv.put(k, String(cur + 1))
    })
  )
}

export default {
  async fetch(request, env) {
    const kv = env && env.TELEMETRY
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

    if (request.method === 'GET') {
      const out = {}
      if (kv) {
        const list = await kv.list({ limit: 1000 })
        for (const { name } of list.keys) out[name] = parseInt((await kv.get(name)) || '0', 10) || 0
      }
      return new Response(JSON.stringify(out, null, 2), {
        headers: { 'content-type': 'application/json', ...CORS },
      })
    }

    if (request.method === 'POST') {
      let body
      try {
        body = await request.json()
      } catch {
        return new Response('bad json', { status: 400, headers: CORS })
      }
      const event = typeof body?.event === 'string' ? body.event : ''
      if (!ALLOWED_EVENTS.has(event)) return new Response(null, { status: 204, headers: CORS })

      // Build aggregate counter keys from the allowlisted fields only. No raw
      // payload, no install id, nothing identifying is persisted.
      const keys = [`event:${event}`, 'event:total']
      for (const [field, max] of Object.entries(STRING_FIELDS)) {
        const v = body[field]
        if (typeof v === 'string' && v) keys.push(`${field}:${v.slice(0, max).replace(/[^\w.\-]/g, '')}`)
      }
      for (const field of BOOL_FIELDS) {
        if (body[field] === true) keys.push(`feature:${field}`)
      }
      await bump(kv, keys)
      return new Response(null, { status: 204, headers: CORS })
    }

    return new Response('method not allowed', { status: 405, headers: CORS })
  },
}
