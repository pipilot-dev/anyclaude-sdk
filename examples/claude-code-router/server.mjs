// claude-code-router (anyclaude-sdk edition)
// ------------------------------------------------------------------
// An Anthropic Messages API-compatible server. Point Claude Code (or any
// Anthropic-Messages client) at it with:
//
//   ANTHROPIC_BASE_URL=http://localhost:8787 ANTHROPIC_API_KEY=dummy claude
//
// ...and every turn is served by whatever OpenAI-compatible model you route to
// (DeepSeek, Qwen, GLM, Kimi, local Ollama, OpenRouter, …). Unlike a naive
// proxy, this uses anyclaude-sdk's tool-call DIALECT recovery + model profiles,
// so models that emit tool calls as text still produce valid Anthropic
// `tool_use` blocks — i.e. tool use actually works on the cheap models.
//
// Zero dependencies beyond anyclaude-sdk + Node. Configure via router.config.json.
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { createOpenAIClient } from 'anyclaude-sdk/llm'
import {
  anthropicToChat,
  anthropicSSE,
  streamResultToAnthropicMessage,
} from 'anyclaude-sdk/anthropic-endpoint'

const CONFIG_PATH = process.env.ROUTER_CONFIG || new URL('./router.config.json', import.meta.url)
const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
const PORT = Number(process.env.PORT || config.port || 8787)

// Resolve a provider by route, building an LLMClient for it.
function clientForRoute(routeName) {
  const providerName = config.routes?.[routeName] || config.routes?.default
  const p = config.providers?.[providerName]
  if (!p) throw new Error(`No provider for route "${routeName}" (provider "${providerName}")`)
  const apiKey = p.apiKeyEnv ? process.env[p.apiKeyEnv] : p.apiKey
  const llm = createOpenAIClient({
    baseUrl: p.baseUrl,
    model: p.model,
    apiKey,
    headers: p.headers,
    profile: p.profile, // omit → auto-detected from the model id
  })
  return { llm, model: p.model, providerName }
}

// Pick a route the way claude-code-router does: background (small/haiku model),
// long-context (large prompt), or default.
function pickRoute(body) {
  const model = String(body.model || '').toLowerCase()
  if (/haiku|background|small/.test(model)) return 'background'
  const approxTokens = JSON.stringify(body.messages || []).length / 4
  if (approxTokens > (config.longContextThreshold || 60000)) return 'longContext'
  return 'default'
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ ok: true, routes: config.routes }))
    }

    // Claude Code calls count_tokens to size context — give a cheap estimate.
    if (req.method === 'POST' && req.url?.endsWith('/messages/count_tokens')) {
      const body = JSON.parse((await readBody(req)) || '{}')
      const approx = Math.ceil(JSON.stringify(body).length / 4)
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ input_tokens: approx }))
    }

    if (req.method === 'POST' && req.url?.endsWith('/messages')) {
      const body = JSON.parse((await readBody(req)) || '{}')
      const route = pickRoute(body)
      const { llm, model, providerName } = clientForRoute(route)
      const chatReq = anthropicToChat(body)
      console.error(`→ ${body.model}  [route:${route} → ${providerName}/${model}]  stream=${chatReq.stream}`)

      const ac = new AbortController()
      req.on('close', () => ac.abort())

      if (chatReq.stream) {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        })
        for await (const chunk of anthropicSSE(llm, chatReq, { model, signal: ac.signal })) {
          res.write(chunk)
        }
        return res.end()
      }

      // Non-streaming: run one turn, return an Anthropic Message object.
      let text = ''
      const result = await llm.streamChat(chatReq.messages, {
        model,
        tools: chatReq.tools.length ? chatReq.tools : undefined,
        signal: ac.signal,
        onToken: (d) => {
          text += d
        },
      })
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify(streamResultToAnthropicMessage(result, { model })))
    }

    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: `No route ${req.method} ${req.url}` } }))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('✗', message)
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message } }))
  }
})

server.listen(PORT, () => {
  console.error(`claude-code-router (anyclaude-sdk) on http://localhost:${PORT}`)
  console.error(`Point Claude Code at it:`)
  console.error(`  ANTHROPIC_BASE_URL=http://localhost:${PORT} ANTHROPIC_API_KEY=dummy claude`)
})
