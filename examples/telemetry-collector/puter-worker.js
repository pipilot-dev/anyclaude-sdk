// Puter Worker variant of the anyclaude-sdk telemetry collector.
// Deploy with: puter.workers.create('anyclaude-telemetry', '<path-to-this-file>')
//
// Same guarantees as worker.mjs: validates against a strict allowlist and keeps
// AGGREGATE counters only (in the worker owner's KV via `me.puter.kv`). Never
// stores raw payloads or anything identifying.
//
//   POST /  → record one event (204)
//   GET  /  → aggregate counters (JSON)

const PREFIX = 'tel:'
const ALLOWED_EVENTS = new Set(['run'])
const STRING_FIELDS = { runtime: 12, sdk_version: 16, model_family: 24 }
const BOOL_FIELDS = [
  'client_workspace_tools', 'client_tools', 'survivor', 'mcp', 'team',
  'background', 'auto_compact', 'skills', 'sessions', 'partial_messages', 'resumed',
]
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, puter-auth',
  'access-control-max-age': '86400',
}

router.options('/*path', async () => new Response(null, { status: 204, headers: CORS }))

router.post('/', async ({ request }) => {
  let body
  try {
    body = await request.json()
  } catch {
    return new Response('bad json', { status: 400, headers: CORS })
  }
  const event = typeof body?.event === 'string' ? body.event : ''
  if (!ALLOWED_EVENTS.has(event)) return new Response(null, { status: 204, headers: CORS })

  const keys = [`event:${event}`, 'event:total']
  for (const [field, max] of Object.entries(STRING_FIELDS)) {
    const v = body[field]
    if (typeof v === 'string' && v) keys.push(`${field}:${v.slice(0, max).replace(/[^\w.\-]/g, '')}`)
  }
  for (const field of BOOL_FIELDS) {
    if (body[field] === true) keys.push(`feature:${field}`)
  }
  await Promise.all(keys.map((k) => me.puter.kv.incr(PREFIX + k)))
  return new Response(null, { status: 204, headers: CORS })
})

router.get('/', async () => {
  const out = {}
  try {
    const entries = await me.puter.kv.list(PREFIX + '*', true)
    for (const e of entries || []) {
      const key = (e.key ?? e.name ?? '').slice(PREFIX.length)
      if (key) out[key] = Number(e.value) || 0
    }
  } catch {
    /* empty */
  }
  return new Response(JSON.stringify(out, null, 2), {
    status: 200,
    headers: { 'content-type': 'application/json', ...CORS },
  })
})
