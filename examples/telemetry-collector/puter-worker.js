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

  const day = new Date().toISOString().slice(0, 10) // UTC date bucket for trends
  const keys = [`event:${event}`, 'event:total', `day:${day}`]
  for (const [field, max] of Object.entries(STRING_FIELDS)) {
    const v = body[field]
    if (typeof v === 'string' && v) keys.push(`${field}:${v.slice(0, max).replace(/[^\w.\-]/g, '')}`)
  }
  for (const field of BOOL_FIELDS) {
    if (body[field] === true) keys.push(`feature:${field}`)
  }
  await Promise.all(keys.map((k) => me.puter.kv.incr(PREFIX + k)))

  // Unique-install count: dedupe on the anonymous install id via a marker key.
  // The marker (and the id) is NEVER returned by GET — only the count is.
  const id = typeof body.install === 'string' ? body.install.slice(0, 64).replace(/[^\w-]/g, '') : ''
  if (id) {
    const seenKey = PREFIX + 'seen:' + id
    if (!(await me.puter.kv.get(seenKey))) {
      await me.puter.kv.set(seenKey, '1')
      await me.puter.kv.incr(PREFIX + 'installs:unique')
    }
  }
  return new Response(null, { status: 204, headers: CORS })
})

// Owner-only: wipe all collector counters. Call via puter.workers.exec() (which
// injects the caller's auth as `user`); authorized only when the caller is the
// worker owner. A plain public POST has no `user` and is rejected.
router.post('/__reset', async () => {
  let authorized = false
  try {
    if (typeof user !== 'undefined' && user?.puter?.whoami && me?.puter?.whoami) {
      const [m, u] = await Promise.all([me.puter.whoami(), user.puter.whoami()])
      authorized = !!(m && u && m.uuid === u.uuid)
    }
  } catch {
    /* not authorized */
  }
  if (!authorized) return new Response('forbidden', { status: 403, headers: CORS })
  let n = 0
  try {
    const keys = await me.puter.kv.list(PREFIX + '*')
    for (const k of keys || []) {
      const key = typeof k === 'string' ? k : (k.key ?? k.name)
      if (key) {
        await me.puter.kv.del(key)
        n++
      }
    }
  } catch (e) {
    return new Response('err: ' + String(e), { status: 500, headers: CORS })
  }
  return new Response(JSON.stringify({ reset: n }), { status: 200, headers: { ...CORS, 'content-type': 'application/json' } })
})

router.get('/', async () => {
  const out = {}
  try {
    const entries = await me.puter.kv.list(PREFIX + '*', true)
    for (const e of entries || []) {
      const key = (e.key ?? e.name ?? '').slice(PREFIX.length)
      // Never expose the per-install dedupe markers (they hold the anonymous id).
      if (!key || key.startsWith('seen:')) continue
      out[key] = Number(e.value) || 0
    }
  } catch {
    /* empty */
  }
  return new Response(JSON.stringify(out, null, 2), {
    status: 200,
    headers: { 'content-type': 'application/json', ...CORS },
  })
})
