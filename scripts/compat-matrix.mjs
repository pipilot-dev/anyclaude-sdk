#!/usr/bin/env node
// Compatibility matrix harness — exercise the REAL anyclaude-sdk tool loop
// against any set of OpenAI/Anthropic-compatible endpoints and emit a markdown
// pass/fail table. This is how we substantiate "tool use works on model X"
// with evidence instead of marketing.
//
// For each model it runs two batteries against a tiny 2-step arithmetic task
// (the model must CALL an `add` tool, then USE the result in its answer):
//
//   1. "native"        — tool dialects OFF (toolDialects: []). Passes only if
//                        the model emits native function-calls correctly.
//   2. "with anyclaude" — default profile (inline dialects + arg repair ON).
//                        This is the value-add: models that fail native often
//                        pass here via dialect recovery + self-healing repair.
//
// Usage:
//   1) Build first:           npm run build
//   2) Provide a config JSON: node scripts/compat-matrix.mjs ./compat.config.json
//      or set COMPAT_CONFIG=/path/to/config.json
//      or pass --demo to print the offline deterministic self-check only.
//
// Config shape (compat.config.json):
//   {
//     "endpoints": [
//       { "label": "GPT-4o",        "baseUrl": "https://api.openai.com/v1", "model": "gpt-4o",            "apiKey": "env:OPENAI_API_KEY" },
//       { "label": "Qwen (Ollama)", "baseUrl": "http://localhost:11434/v1", "model": "qwen2.5-coder:7b" },
//       { "label": "DeepSeek",      "baseUrl": "https://api.deepseek.com/v1","model": "deepseek-chat",    "apiKey": "env:DEEPSEEK_API_KEY" }
//     ]
//   }
//
// `apiKey` accepts "env:NAME" to read from the environment (keys never live in
// the config file). Output is markdown on stdout — pipe to a file or a docs page.

import { readFileSync, writeFileSync } from 'node:fs'

const { runToolLoop } = await import('../dist/loop.js')
const { createOpenAIClient } = await import('../dist/llm/openai.js')
const { profileForModel } = await import('../dist/llm/profiles.js')

const ADD_TOOL = {
  def: {
    type: 'function',
    function: {
      name: 'add',
      description: 'Add two integers and return their sum.',
      parameters: {
        type: 'object',
        properties: { a: { type: 'number' }, b: { type: 'number' } },
        required: ['a', 'b'],
      },
    },
  },
  async run(input) {
    return { content: String(Number(input.a) + Number(input.b)) }
  },
}

const TASK = 'Use the add tool to compute 17 + 25, then reply with EXACTLY the number and nothing else.'
const EXPECTED = '42'

function resolveKey(apiKey) {
  if (!apiKey) return undefined
  if (apiKey.startsWith('env:')) return process.env[apiKey.slice(4)]
  return apiKey
}

async function runBattery(ep, { native }) {
  const llm = createOpenAIClient({
    baseUrl: ep.baseUrl,
    model: ep.model,
    apiKey: resolveKey(ep.apiKey),
    headers: ep.headers,
    ...(native ? { toolDialects: [] } : {}),
  })
  const history = [
    { role: 'system', content: 'You are a precise assistant. Use tools when asked.' },
    { role: 'user', content: TASK },
  ]
  const ctx = { fs: {}, exec: {}, cwd: '/', readFiles: new Set() }
  let calledAdd = false
  let finalText = ''
  let error = null
  const t0 = Date.now()
  try {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), ep.timeoutMs ?? 60000)
    for await (const m of runToolLoop({ history, tools: [ADD_TOOL], llm, model: ep.model, ctx, maxTurns: 6, signal: ac.signal })) {
      if (m.type === 'assistant') {
        for (const b of m.message.content) {
          if (b.type === 'tool_use' && b.name === 'add') calledAdd = true
          if (b.type === 'text') finalText = b.text
        }
      }
      if (m.type === 'result' && m.subtype === 'success') finalText = m.result || finalText
    }
    clearTimeout(timer)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  const ms = Date.now() - t0
  const answered = new RegExp(`(^|\\D)${EXPECTED}(\\D|$)`).test(finalText)
  return { pass: calledAdd && answered, calledAdd, answered, ms, error }
}

function mark(b) {
  if (b.error) return `error`
  if (b.pass) return `pass`
  if (b.calledAdd && !b.answered) return `partial (called, wrong answer)`
  if (!b.calledAdd) return `fail (no tool call)`
  return 'fail'
}

function flagValue(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const out = flagValue('--out')
  const positional = process.argv.slice(2).find((a) => !a.startsWith('--'))
  const wantDemo = process.argv.includes('--demo') || (!positional && !process.env.COMPAT_CONFIG)

  let markdown
  if (wantDemo) {
    markdown = demoMarkdown()
  } else {
    const path = positional || process.env.COMPAT_CONFIG
    const cfg = JSON.parse(readFileSync(path, 'utf8'))
    const rows = []
    for (const ep of cfg.endpoints) {
      process.stderr.write(`• ${ep.label} (${ep.model}) … `)
      const native = await runBattery(ep, { native: true })
      const full = await runBattery(ep, { native: false })
      const prof = profileForModel(ep.profile ?? ep.model)
      rows.push({ ep, native, full, prof })
      process.stderr.write(`native=${mark(native)} | anyclaude=${mark(full)}\n`)
    }
    markdown = buildMarkdown(rows)
  }

  console.log(markdown)
  if (out) {
    writeFileSync(out, markdown.endsWith('\n') ? markdown : markdown + '\n')
    process.stderr.write(`\nWrote ${out}\n`)
  }
}

function buildMarkdown(rows) {
  const date = new Date().toISOString().slice(0, 10)
  const lines = [
    `# anyclaude-sdk tool-use compatibility matrix`,
    ``,
    `_Generated ${date} by \`scripts/compat-matrix.mjs\`. Task: call \`add(17,25)\` then answer \`42\`._`,
    ``,
    `| Model | Endpoint | Native tool-calls | With anyclaude (dialects + repair) | Profile | Latency |`,
    `|---|---|---|---|---|---|`,
  ]
  for (const { ep, native, full, prof } of rows) {
    lines.push(`| ${ep.label} | \`${ep.model}\` | ${mark(native)} | ${mark(full)} | \`${prof.name}\` | ${native.ms + full.ms}ms |`)
  }
  lines.push(``)
  lines.push(`> "With anyclaude" turns failing-native models green via inline dialect recovery + self-healing argument repair. Errors usually mean a bad key, an unreachable baseUrl, or no tool support at all.`)
  return lines.join('\n')
}

function demoMarkdown() {
  const lines = [
    `# anyclaude-sdk tool-use compatibility matrix`,
    ``,
    `> Offline self-check (no network). Live results require provider endpoints + keys —`,
    `> run \`node scripts/compat-matrix.mjs ./compat.config.json\` (keys via \`env:NAME\`), or`,
    `> set the \`COMPAT_CONFIG_JSON\` + provider-key secrets in the CI workflow.`,
    ``,
    `Built-in model profiles (which dialects each is tried with):`,
    ``,
    `| Model id | Profile | Inline dialects |`,
    `|---|---|---|`,
  ]
  for (const m of ['gpt-4o', 'claude-sonnet-4-6', 'qwen2.5-coder:7b', 'deepseek-chat', 'kimi-k2', 'glm-4', 'mistral-large', 'llama3.1:70b', 'unknown-model']) {
    const p = profileForModel(m)
    lines.push(`| \`${m}\` | \`${p.name}\` | ${(p.dialects ?? []).length ? (p.dialects).join(', ') : '_(native)_'} |`)
  }
  return lines.join('\n')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
