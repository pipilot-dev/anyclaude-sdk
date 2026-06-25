import { mkdtempSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { query } from '../dist/query.js'
import { createOpenAIClient } from '../dist/llm/openai.js'
import { LocalSandbox } from '../dist/sandbox/local.js'

const workdir = mkdtempSync(join(tmpdir(), 'bcs-realestate-'))
const workspace = new LocalSandbox({ cwd: workdir })

// Instrument the LLM client: per-call latency + time-to-first-token + tokens.
const base = createOpenAIClient({ baseUrl: 'https://api.kilo.ai/api/gateway', model: 'kilo-auto/free' })
const calls = []
const llm = {
  async streamChat(messages, opts) {
    const t = performance.now()
    let ttft = null
    const r = await base.streamChat(messages, {
      ...opts,
      onToken: (d) => { if (ttft === null) ttft = performance.now() - t; opts.onToken(d) },
    })
    calls.push({ dur: performance.now() - t, ttft, out: r.usage?.output_tokens ?? 0, in: r.usage?.input_tokens ?? 0 })
    return r
  },
}

const PROMPT = `Build a complete, polished real-estate website called "Estately" using HTML, CSS and vanilla JS with Tailwind CSS via CDN.
Requirements:
- index.html: sticky navbar, a hero section with a property search bar (location, type, price range), a responsive grid of at least 6 property listing cards (image placeholder, price, title, address, beds/baths/sqft), a "Featured" section, an "Our Agents" section with 3 agents, a stats band, and a contact form + footer.
- listings.js: an array of >=6 sample properties and code that renders the cards into the grid dynamically, plus a simple client-side filter by type and max price wired to the search bar.
- Make it responsive and visually appealing (Tailwind utility classes, hover states).
Create the files, then run \`ls -la\` to confirm them.`

const tToolByName = {}
let firstMsgAt = null, firstTokenAt = null
const t0 = performance.now()
const abort = new AbortController()
const timer = setTimeout(() => abort.abort(), 300_000)

let lastAssistantAt = null
const toolPhases = [] // ms spent between an assistant tool_use turn and its tool_result

try {
  for await (const msg of query({
    prompt: PROMPT, workspace, llm, model: 'kilo-auto/free',
    maxTurns: 40, includePartialMessages: true, abortController: abort,
  })) {
    const now = performance.now()
    if (firstMsgAt === null) firstMsgAt = now - t0
    if (msg.type === 'stream_event') { if (firstTokenAt === null) firstTokenAt = now - t0; continue }
    if (msg.type === 'assistant') {
      lastAssistantAt = now
      for (const b of msg.message.content) {
        if (b.type === 'tool_use') tToolByName[b.name] = (tToolByName[b.name] ?? 0) + 1
        if (b.type === 'text' && b.text.trim()) console.log('  · assistant:', b.text.trim().slice(0, 90).replace(/\n/g, ' '))
      }
    } else if (msg.type === 'user' && msg.isSynthetic) {
      if (lastAssistantAt != null) { toolPhases.push(now - lastAssistantAt); lastAssistantAt = null }
    } else if (msg.type === 'result') {
      const wall = (performance.now() - t0) / 1000
      const apiMs = calls.reduce((s, c) => s + c.dur, 0)
      const outTok = calls.reduce((s, c) => s + c.out, 0)
      const inTok = calls.reduce((s, c) => s + c.in, 0)
      const ttfts = calls.map((c) => c.ttft).filter((x) => x != null)
      const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)
      const toolWall = toolPhases.reduce((s, x) => s + x, 0)
      console.log('\n================ BENCHMARK ================')
      console.log('status            :', msg.subtype)
      console.log('wall clock        :', wall.toFixed(1), 's')
      console.log('time-to-first-msg :', (firstMsgAt ?? 0).toFixed(0), 'ms')
      console.log('time-to-first-token:', (firstTokenAt ?? 0).toFixed(0), 'ms')
      console.log('agent turns       :', msg.num_turns)
      console.log('LLM calls         :', calls.length)
      console.log('  total API time  :', (apiMs / 1000).toFixed(1), 's  (', ((apiMs / 1000 / wall) * 100).toFixed(0), '% of wall )')
      console.log('  avg call latency:', (avg(calls.map((c) => c.dur))).toFixed(0), 'ms   min', Math.min(...calls.map((c) => c.dur)).toFixed(0), 'max', Math.max(...calls.map((c) => c.dur)).toFixed(0))
      console.log('  avg TTFT/call   :', avg(ttfts).toFixed(0), 'ms')
      console.log('tool exec time    :', (toolWall / 1000).toFixed(1), 's   (local fs/shell)')
      console.log('tokens            : in', inTok, ' out', outTok, ' total', inTok + outTok)
      console.log('throughput        :', apiMs > 0 ? (outTok / (apiMs / 1000)).toFixed(1) : '—', 'output tok/s')
      console.log('cost (est)        : $' + msg.total_cost_usd.toFixed(4))
      console.log('tools used        :', JSON.stringify(tToolByName))
    }
  }
} catch (e) {
  console.error('FATAL:', e?.message || e)
} finally {
  clearTimeout(timer)
}

// Files produced on the real filesystem.
const files = []
const walk = (d, p = '') => { for (const n of readdirSync(d)) { const fp = join(d, n); const s = statSync(fp); if (s.isDirectory()) walk(fp, p + n + '/'); else files.push([p + n, s.size]) } }
walk(workdir)
console.log('\nfiles on disk     :')
for (const [f, sz] of files) console.log('   ', f, '·', sz, 'bytes')
console.log('workdir           :', workdir)
