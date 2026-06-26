// Tool-call repair — validate a model's tool arguments BEFORE executing, and on
// failure produce a precise corrective message instead of running the tool with
// garbage. The agent loop feeds that message back as an `is_error` tool_result,
// so the model self-heals on the next turn (it sees exactly what was wrong and
// the expected schema). This is the single biggest reliability win for weak /
// cheap models, which frequently emit malformed or incomplete tool JSON.
//
// Validation is intentionally light: JSON parseability + required-property
// presence + a primitive type check. It is NOT a full JSON-Schema validator —
// the goal is to catch the common, recoverable mistakes and hand the model an
// actionable hint, not to enforce the spec. Browser-clean (no deps).
import type { ToolDef } from '../types/index.js'

export interface ArgValidation {
  /** True when the arguments parsed and satisfied required props / basic types. */
  ok: boolean
  /** Parsed arguments (best-effort: `{}` when unparseable). */
  input: Record<string, unknown>
  /** When `ok` is false, a concise, model-facing explanation + schema hint. */
  error?: string
}

/**
 * Validate raw tool-call argument JSON against a tool definition.
 *
 * - Unparseable JSON → `ok:false` with the parse error and the expected schema.
 * - Missing required properties → `ok:false` listing them.
 * - Wrong primitive type on a provided property → `ok:false`.
 * - No def (unknown tool / client tool) → parse-only; never blocks.
 */
export function validateToolArguments(def: ToolDef | undefined, rawArgs: string): ArgValidation {
  const raw = rawArgs?.trim() ? rawArgs : '{}'
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      input: {},
      error: def
        ? `Arguments for "${def.function.name}" were not valid JSON (${msg}). Call the tool again with a single valid JSON object matching: ${schemaHint(def)}`
        : `Tool arguments were not valid JSON (${msg}). Send a single valid JSON object.`,
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      input: {},
      error: def
        ? `Arguments for "${def.function.name}" must be a JSON object. Expected: ${schemaHint(def)}`
        : 'Tool arguments must be a JSON object.',
    }
  }
  const input = parsed as Record<string, unknown>

  // No schema to check against (unknown / client-delegated tool) — accept.
  if (!def) return { ok: true, input }

  const props = (def.function.parameters?.properties ?? {}) as Record<string, { type?: string }>
  const required = def.function.parameters?.required ?? []

  const missing = required.filter((k) => input[k] === undefined || input[k] === null)
  if (missing.length) {
    return {
      ok: false,
      input,
      error: `Missing required argument${missing.length > 1 ? 's' : ''} for "${def.function.name}": ${missing
        .map((k) => `"${k}"`)
        .join(', ')}. Call it again including ${missing.length > 1 ? 'them' : 'it'}. Expected: ${schemaHint(def)}`,
    }
  }

  // Light primitive type check on provided props.
  for (const [key, val] of Object.entries(input)) {
    const want = props[key]?.type
    if (!want || val === null || val === undefined) continue
    if (!matchesType(val, want)) {
      return {
        ok: false,
        input,
        error: `Argument "${key}" for "${def.function.name}" should be ${want}, got ${jsType(
          val
        )}. Call it again with the correct type. Expected: ${schemaHint(def)}`,
      }
    }
  }

  return { ok: true, input }
}

/** A compact one-line schema hint: `{ path: string (required), recursive?: boolean }`. */
export function schemaHint(def: ToolDef): string {
  const props = (def.function.parameters?.properties ?? {}) as Record<string, { type?: string }>
  const required = new Set(def.function.parameters?.required ?? [])
  const parts = Object.entries(props).map(([k, v]) => {
    const req = required.has(k)
    return `${k}${req ? '' : '?'}: ${v?.type ?? 'any'}${req ? ' (required)' : ''}`
  })
  return `{ ${parts.join(', ')} }`
}

function jsType(v: unknown): string {
  if (Array.isArray(v)) return 'array'
  return typeof v
}

function matchesType(v: unknown, want: string): boolean {
  switch (want) {
    case 'string':
      return typeof v === 'string'
    case 'number':
    case 'integer':
      return typeof v === 'number'
    case 'boolean':
      return typeof v === 'boolean'
    case 'array':
      return Array.isArray(v)
    case 'object':
      return typeof v === 'object' && !Array.isArray(v) && v !== null
    default:
      return true // unknown/`any` — don't block
  }
}
