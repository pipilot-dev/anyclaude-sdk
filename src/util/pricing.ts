// Best-effort token pricing for cost accounting. USD per 1M tokens.
// Matched by longest-prefix against the model id; unknown models cost 0 (and
// callers can detect that via `priceFor` returning undefined).
//
// These are list prices and may drift — treat total_cost_usd as an estimate.

import type { Usage } from '../types/index.js'

export type Pricing = {
  inputPerM: number
  outputPerM: number
  /** Cost of cache-read (cached input) tokens per 1M. Defaults to a fraction of input. */
  cacheReadPerM?: number
  /** Cost of cache-write (cache creation) tokens per 1M. */
  cacheWritePerM?: number
}

// Keys are prefixes; the longest matching prefix wins.
const TABLE: Record<string, Pricing> = {
  // Anthropic
  'claude-opus-4': { inputPerM: 15, outputPerM: 75, cacheReadPerM: 1.5, cacheWritePerM: 18.75 },
  'claude-sonnet-4': { inputPerM: 3, outputPerM: 15, cacheReadPerM: 0.3, cacheWritePerM: 3.75 },
  'claude-haiku-4': { inputPerM: 1, outputPerM: 5, cacheReadPerM: 0.1, cacheWritePerM: 1.25 },
  'claude-3-5-haiku': { inputPerM: 0.8, outputPerM: 4, cacheReadPerM: 0.08, cacheWritePerM: 1 },
  'claude-3-5-sonnet': { inputPerM: 3, outputPerM: 15, cacheReadPerM: 0.3, cacheWritePerM: 3.75 },
  'claude-3-opus': { inputPerM: 15, outputPerM: 75 },
  // OpenAI
  'gpt-4o-mini': { inputPerM: 0.15, outputPerM: 0.6, cacheReadPerM: 0.075 },
  'gpt-4o': { inputPerM: 2.5, outputPerM: 10, cacheReadPerM: 1.25 },
  'gpt-4.1-mini': { inputPerM: 0.4, outputPerM: 1.6 },
  'gpt-4.1': { inputPerM: 2, outputPerM: 8 },
  'o3-mini': { inputPerM: 1.1, outputPerM: 4.4 },
  'o3': { inputPerM: 2, outputPerM: 8 },
  'o1': { inputPerM: 15, outputPerM: 60 },
  // xAI (Grok). Cached-input rate not published per-model → defaults apply.
  'grok-build': { inputPerM: 1, outputPerM: 2, cacheReadPerM: 0.25 },
  'grok-code': { inputPerM: 0.2, outputPerM: 1.5 },
  'grok-4': { inputPerM: 3, outputPerM: 15 },
  'grok-3-mini': { inputPerM: 0.3, outputPerM: 0.5 },
  'grok-3': { inputPerM: 3, outputPerM: 15 },
}

// Context window (max input+output tokens) by model prefix. Best-effort.
const CONTEXT_WINDOWS: Record<string, number> = {
  'grok-build': 256_000,
  'grok-code': 256_000,
  'grok-4': 256_000,
  'grok-3': 131_072,
  'claude-sonnet-4': 200_000,
  'claude-opus-4': 200_000,
  'claude-haiku-4': 200_000,
  'claude-3': 200_000,
  'gpt-4o': 128_000,
  'gpt-4.1': 1_047_576,
  o3: 200_000,
  o1: 200_000,
}

/** Context window for a model id by longest-prefix match (0 if unknown). */
export function contextWindowFor(model: string): number {
  const id = model.toLowerCase()
  let best: { key: string; v: number } | undefined
  for (const [key, v] of Object.entries(CONTEXT_WINDOWS)) {
    if (id.includes(key) && (!best || key.length > best.key.length)) best = { key, v }
  }
  return best?.v ?? 0
}

/** Find pricing for a model id by longest-prefix match. */
export function priceFor(model: string): Pricing | undefined {
  const id = model.toLowerCase()
  let best: { key: string; p: Pricing } | undefined
  for (const [key, p] of Object.entries(TABLE)) {
    if (id.includes(key) && (!best || key.length > best.key.length)) best = { key, p }
  }
  return best?.p
}

/** Estimate USD cost for a usage record under a model's pricing. 0 if unknown. */
export function computeCostUSD(model: string, usage: Usage): number {
  const p = priceFor(model)
  if (!p) return 0
  const cacheRead = usage.cache_read_input_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  // input_tokens from providers typically excludes cached/cache-creation; bill
  // those at their own rates and the remainder at the input rate.
  const plainInput = Math.max(0, usage.input_tokens - cacheRead - cacheWrite)
  const cost =
    (plainInput * p.inputPerM +
      usage.output_tokens * p.outputPerM +
      cacheRead * (p.cacheReadPerM ?? p.inputPerM * 0.1) +
      cacheWrite * (p.cacheWritePerM ?? p.inputPerM * 1.25)) /
    1_000_000
  return cost
}
