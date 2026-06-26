# claude-code-router (anyclaude-sdk edition)

Run **Claude Code against any OpenAI-compatible model** — DeepSeek, Qwen, GLM, Kimi, local Ollama, OpenRouter — by standing up an Anthropic Messages API-compatible endpoint backed by [`anyclaude-sdk`](https://www.npmjs.com/package/anyclaude-sdk).

It's the same idea as [`claude-code-router`](https://www.npmjs.com/package/@musistudio/claude-code-router), with one difference that matters: it runs anyclaude-sdk's **tool-call dialect recovery + model profiles** under the hood. Cheap/open models that emit tool calls as *text* (Qwen's `<tool_call>{…}</tool_call>`, DeepSeek's JSON fences, vLLM's `<function=…>`) are normalized back into proper Anthropic `tool_use` blocks — so tool use actually works, not just chat.

## How it works

Claude Code runs the agent loop on your machine and sends each turn to `ANTHROPIC_BASE_URL` as an Anthropic Messages request. This server:

1. Converts the Anthropic request → the SDK's neutral `ChatMsg[]` + tool defs (`anthropicToChat`).
2. Picks a backend by route (default / background / long-context) and builds an `LLMClient` (`createOpenAIClient`) — which auto-detects a model profile and recovers inline tool-call dialects.
3. Streams the result back as the exact Anthropic SSE event sequence (`anthropicSSE`), with `tool_use` blocks normalized.

The agent loop stays in Claude Code; this is a per-turn translation layer, not a second agent.

## Run it

```bash
cd examples/claude-code-router
npm install
# set whatever keys your routes need:
export DEEPSEEK_API_KEY=sk-...        # for the default route in the sample config
npm start                              # → http://localhost:8787
```

Then point Claude Code at it (in another terminal):

```bash
ANTHROPIC_BASE_URL=http://localhost:8787 ANTHROPIC_API_KEY=dummy claude
```

`ANTHROPIC_API_KEY` is unused by the upstream (the router holds the real provider keys) but Claude Code requires it to be set.

## Configure routing — `router.config.json`

```jsonc
{
  "providers": {
    "deepseek":   { "baseUrl": "https://api.deepseek.com/v1", "model": "deepseek-chat", "apiKeyEnv": "DEEPSEEK_API_KEY" },
    "qwen-local": { "baseUrl": "http://localhost:11434/v1",   "model": "qwen2.5-coder:7b" },
    "glm":        { "baseUrl": "https://api.z.ai/api/paas/v4", "model": "glm-4", "apiKeyEnv": "ZAI_API_KEY" }
  },
  "routes": {
    "default":     "deepseek",     // most turns
    "background":  "qwen-local",   // small/haiku-tier requests → cheap local model
    "longContext": "deepseek"      // prompts over longContextThreshold tokens
  }
}
```

- **`apiKeyEnv`** names an environment variable to read the key from (keys never live in the file). Or set `apiKey` directly.
- **`profile`** (optional) forces a model profile (`qwen`, `deepseek`, `moonshot`, `zhipu`, `mistral`, `llama`); omit to auto-detect from the model id.
- **`headers`** (optional) for gateways that need extra headers (OpenRouter, etc.).
- Point `ROUTER_CONFIG=/path/to/config.json` to use a different file.

## Endpoints

- `POST /v1/messages` — the Anthropic Messages endpoint (streaming + non-streaming).
- `POST /v1/messages/count_tokens` — rough token estimate (Claude Code calls this to size context).
- `GET /health` — liveness + active routes.

## Caveats

- This serves **one assistant turn per request** (Claude Code owns the loop). It is a translation layer, not anyclaude-sdk's own `query()` engine.
- Tool-call reliability depends on the backing model. Run the [compatibility-matrix harness](../../scripts/compat-matrix.mjs) against your endpoints first; cheap models vary.
- Keep your provider API keys server-side. Don't expose this endpoint publicly without auth.
