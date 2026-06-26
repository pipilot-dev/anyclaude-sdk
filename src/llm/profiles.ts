// Model profiles — per-model quirks for reliable tool use against the long tail
// of OpenAI-compatible endpoints (Qwen, DeepSeek, Kimi/Moonshot, GLM/Zhipu,
// Mistral, Llama/Ollama, …). Frontier models (GPT, Claude) emit clean native
// tool_calls; cheaper / open models often don't, so we (a) tell the client
// which inline DIALECTS to fall back to, (b) tune tool_choice / parallel /
// temperature for tool reliability, and (c) optionally inject a short tool-use
// scaffolding prompt.
//
// This is best-effort heuristics, not a guarantee — see the published
// compatibility matrix. Profiles are additive: an explicit option always wins
// over a profile default. Browser-clean (no deps).
import type { ToolDef } from '../types/index.js'
import { DEFAULT_DIALECTS } from './dialects.js'

export interface ModelProfile {
  /** Stable id, e.g. 'qwen' | 'deepseek' | 'openai' | 'generic'. */
  name: string
  /** Match by model id (already lowercased before this is called). */
  match: (model: string) => boolean
  /** Inline dialects to attempt (in order) when native tool_calls are absent. */
  dialects?: string[]
  /** tool_choice to send when tools are present. */
  toolChoice?: 'auto' | 'required' | 'none'
  /** parallel_tool_calls. Some models break or loop on parallel calls. */
  parallelToolCalls?: boolean
  /** Suggested temperature for stable tool use (lower = more deterministic). */
  temperature?: number
  /** Whether a short tool-use scaffolding prompt helps this family. */
  injectToolGuidance?: boolean
  /** Human note surfaced in the compatibility matrix / docs. */
  note?: string
}

const has =
  (...needles: string[]) =>
  (model: string) =>
    needles.some((n) => model.includes(n))

// Ordered most-specific → most-general; first match wins.
export const builtinProfiles: ModelProfile[] = [
  {
    name: 'openai',
    match: has('gpt-', 'gpt4', 'o1', 'o3', 'o4', 'chatgpt'),
    dialects: [], // native tool_calls are reliable
    toolChoice: 'auto',
    parallelToolCalls: true,
    note: 'Native tool_calls; no inline fallback needed.',
  },
  {
    name: 'anthropic',
    match: has('claude'),
    dialects: [],
    toolChoice: 'auto',
    note: 'Native tool use; clean function-calling.',
  },
  {
    name: 'qwen',
    match: has('qwen', 'qwq'),
    dialects: ['hermes', 'xml-function', 'json-fence'],
    toolChoice: 'auto',
    parallelToolCalls: false,
    temperature: 0.3,
    injectToolGuidance: true,
    note: 'Hermes-style <tool_call>{json}</tool_call>; parallel calls unreliable.',
  },
  {
    name: 'deepseek',
    match: has('deepseek'),
    dialects: ['json-fence', 'hermes', 'xml-function'],
    toolChoice: 'auto',
    parallelToolCalls: false,
    temperature: 0.3,
    injectToolGuidance: true,
    note: 'Often emits tool calls in JSON code fences; keep parallel off.',
  },
  {
    name: 'moonshot',
    match: has('kimi', 'moonshot'),
    dialects: ['hermes', 'json-fence'],
    toolChoice: 'auto',
    parallelToolCalls: false,
    note: 'Kimi/Moonshot — Hermes-style; Anthropic-compatible endpoint also offered.',
  },
  {
    name: 'zhipu',
    match: has('glm', 'zhipu', 'chatglm'),
    dialects: ['xml-function', 'hermes', 'json-fence'],
    toolChoice: 'auto',
    parallelToolCalls: false,
    injectToolGuidance: true,
    note: 'GLM/Zhipu — mixed dialects; sponsors claude-code-router as a cheap backend.',
  },
  {
    name: 'mistral',
    match: has('mistral', 'mixtral', 'codestral', 'devstral', 'magistral'),
    dialects: ['json-fence', 'hermes', 'xml-function'],
    toolChoice: 'auto',
    parallelToolCalls: false,
    temperature: 0.2,
    injectToolGuidance: true,
    note: 'Tool-calling historically fragile; low temperature + repair recommended.',
  },
  {
    name: 'llama',
    match: has('llama', 'codellama'),
    dialects: ['json-fence', 'hermes', 'xml-function'],
    toolChoice: 'auto',
    parallelToolCalls: false,
    temperature: 0.3,
    injectToolGuidance: true,
    note: 'Llama family (often via Ollama) — inline fallback + guidance help a lot.',
  },
]

/** Catch-all for unknown models: try everything, guide, keep parallel off. */
export const genericProfile: ModelProfile = {
  name: 'generic',
  match: () => true,
  dialects: DEFAULT_DIALECTS,
  toolChoice: 'auto',
  parallelToolCalls: false,
  injectToolGuidance: true,
  note: 'Unknown model — full inline fallback + guidance, parallel off, repair on.',
}

/**
 * Resolve a profile for a model id. Pass a `ModelProfile` to use it verbatim, a
 * string name to look up a built-in, or a model id to auto-detect. Unknown →
 * `genericProfile`.
 */
export function profileForModel(model?: string | ModelProfile): ModelProfile {
  if (model && typeof model === 'object') return model
  const id = (model ?? '').toLowerCase()
  if (id) {
    const byName = builtinProfiles.find((p) => p.name === id)
    if (byName) return byName
    const byMatch = builtinProfiles.find((p) => p.match(id))
    if (byMatch) return byMatch
  }
  return genericProfile
}

/**
 * A short, model-agnostic tool-use scaffolding prompt for weak models that
 * narrate tool calls instead of using native function-calling. Append it to the
 * system prompt (e.g. via `query({ appendSystemPrompt })`) when a profile sets
 * `injectToolGuidance`. Lists the available tools so the model knows the names.
 */
export function toolGuidancePrompt(tools: ToolDef[]): string {
  const names = tools.map((t) => `- ${t.function.name}: ${t.function.description}`).join('\n')
  return [
    'When you need to use a tool, prefer the native function-calling format.',
    'If you cannot, emit EXACTLY one tool call per turn as a single JSON object',
    'wrapped in <tool_call>…</tool_call> tags, with this shape:',
    '<tool_call>{"name": "<tool_name>", "arguments": { /* params */ }}</tool_call>',
    'Do not wrap it in prose. Use only these tools:',
    names,
  ].join('\n')
}
