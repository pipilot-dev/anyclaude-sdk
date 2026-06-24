// Parsing + cascading merge for settings sources.

import type { Settings } from './types.js'

/** Array-valued keys are concatenated + deduped across sources. */
const ARRAY_KEYS = ['allow', 'deny', 'ask', 'allowedTools', 'disallowedTools'] as const

/**
 * Parse a settings.json string. Tolerant: returns {} on invalid JSON. Accepts
 * Claude Code's nested `permissions: { allow, deny, ask }` shape and hoists it
 * to top-level allow/deny/ask.
 */
export function parseSettings(json: string): Settings {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return {}
  }
  if (!raw || typeof raw !== 'object') return {}
  const obj = raw as Record<string, unknown>
  const out: Settings = { ...obj }

  const perms = obj.permissions
  if (perms && typeof perms === 'object') {
    const p = perms as Record<string, unknown>
    for (const key of ['allow', 'deny', 'ask'] as const) {
      if (Array.isArray(p[key])) {
        const existing = Array.isArray(out[key]) ? (out[key] as string[]) : []
        out[key] = dedupe([...existing, ...(p[key] as string[])])
      }
    }
    if (typeof p.defaultMode === 'string') {
      out.permissionMode = (out.permissionMode ?? p.defaultMode) as Settings['permissionMode']
    }
  }
  return out
}

/**
 * Merge settings sources. Later sources win for scalars; array keys are
 * concatenated + deduped; `env` is shallow-merged. Pass lowest → highest
 * precedence (e.g. user, project, local).
 */
export function mergeSettings(...sources: Settings[]): Settings {
  const out: Settings = {}
  for (const src of sources) {
    if (!src) continue
    for (const [key, val] of Object.entries(src)) {
      if (val === undefined) continue
      if ((ARRAY_KEYS as readonly string[]).includes(key)) {
        const existing = Array.isArray(out[key]) ? (out[key] as unknown[]) : []
        out[key] = dedupe([...existing, ...(Array.isArray(val) ? val : [val])])
      } else if (key === 'env' && val && typeof val === 'object') {
        out.env = { ...(out.env ?? {}), ...(val as Record<string, string>) }
      } else {
        out[key] = val
      }
    }
  }
  return out
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)]
}
