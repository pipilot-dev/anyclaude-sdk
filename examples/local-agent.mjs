// Headless example: run the agent on the REAL local filesystem (Node), against
// any Anthropic-compatible endpoint.
//
//   npm run build           # produces ./dist
//   node examples/local-agent.mjs "build me a hello-world http server and run it"
//
// Configure via env (all optional):
//   BCS_BASE_URL   Anthropic-compatible base URL (default below)
//   BCS_MODEL      model id (default claude-sonnet-4-6)
//   BCS_API_KEY    api key (omit for keyless endpoints)
//   BCS_CWD        working directory (default: a fresh temp dir)

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { query } from '../dist/query.js'
import { createAnthropicClient } from '../dist/llm/anthropic.js'
import { LocalSandbox } from '../dist/sandbox/local.js'

const baseUrl = process.env.BCS_BASE_URL ?? 'https://the3rdacademy.com/api/v1'
const model = process.env.BCS_MODEL ?? 'claude-sonnet-4-6'
const apiKey = process.env.BCS_API_KEY // undefined => keyless
const cwd = process.env.BCS_CWD ?? mkdtempSync(join(tmpdir(), 'bcs-'))

const promptText =
  process.argv.slice(2).join(' ') ||
  'Create fib.js that prints the first 15 Fibonacci numbers, then run it with node and confirm the output.'

const workspace = new LocalSandbox({ cwd })
const llm = createAnthropicClient({ baseUrl, model, apiKey })

console.log(`platform=${workspace.platform} cwd=${cwd}\nmodel=${model} @ ${baseUrl}\n`)

const abort = new AbortController()
const timer = setTimeout(() => abort.abort(), 180_000)

try {
  for await (const msg of query({ prompt: promptText, workspace, llm, model, maxTurns: 16, abortController: abort })) {
    if (msg.type === 'assistant') {
      for (const b of msg.message.content) {
        if (b.type === 'text' && b.text.trim()) console.log('[assistant]', b.text.trim())
        if (b.type === 'tool_use') console.log(`[tool] ${b.name} ${JSON.stringify(b.input).slice(0, 200)}`)
      }
    } else if (msg.type === 'user' && msg.isSynthetic) {
      const c = msg.message.content[0]?.content
      console.log('  ->', String(typeof c === 'string' ? c : JSON.stringify(c)).slice(0, 200).replace(/\n/g, ' '))
    } else if (msg.type === 'result') {
      console.log(`\n[${msg.subtype}] turns=${msg.num_turns}`)
      if (msg.subtype === 'success') console.log(msg.result)
      else console.log(msg.errors)
    }
  }
} finally {
  clearTimeout(timer)
}
