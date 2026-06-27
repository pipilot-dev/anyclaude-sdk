// Anonymous, opt-out usage telemetry. The goal is a single, honest question:
// "are people adopting the SDK, and which parts?" — answered in AGGREGATE, never
// per-user. This module is deliberately conservative about what it can ever send.
//
// HARD GUARANTEES (enforced here, not just by convention):
//   • It NEVER sends: repo/remote URLs, project/package names, file paths, source
//     code, prompts, messages, tool arguments, LLM responses, API keys, or
//     endpoints/base URLs. `track()` whitelists prop keys and keeps only booleans
//     + a few coarse string buckets — anything else is dropped.
//   • Off with one switch: `ANYCLAUDE_TELEMETRY=0`, `DO_NOT_TRACK=1`, any `CI`,
//     a `disableTelemetry` option, browser `localStorage['anyclaude_telemetry']='0'`,
//     or `globalThis.__ANYCLAUDE_NO_TELEMETRY__ = true`.
//   • No endpoint configured ⇒ no-op (it can't send anywhere by default).
//   • Fire-and-forget: never blocks, never throws, swallows all errors.
//
// See TELEMETRY.md for the full disclosure.
import { uuid } from './util/ids.js'

/** Bump on release so adoption can be bucketed by version. */
export const TELEMETRY_SDK_VERSION = '0.7.0'

export interface TelemetryOptions {
  /** Force-disable for this call (highest precedence besides the global opt-outs). */
  disabled?: boolean
  /** Collector URL. Defaults to `ANYCLAUDE_TELEMETRY_URL` then the built-in default. */
  url?: string
}

// Set this (or `ANYCLAUDE_TELEMETRY_URL`) to your collector. Empty ⇒ no-op.
const DEFAULT_TELEMETRY_URL = ''

// Only these prop keys are ever transmitted, and only with safe value types.
// Booleans pass through; these specific string keys pass through as-is (they are
// coarse buckets we set ourselves — never free-form / user data).
const ALLOWED_STRING_KEYS = new Set(['model_family', 'event_detail'])

function readEnv(name: string): string | undefined {
  const p = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  return p?.env?.[name]
}

/** Resolve whether telemetry may run, honoring every documented opt-out. */
export function telemetryEnabled(opts?: TelemetryOptions): boolean {
  if (opts?.disabled) return false

  const flag = (readEnv('ANYCLAUDE_TELEMETRY') ?? '').toLowerCase()
  if (flag === '0' || flag === 'false' || flag === 'off' || flag === 'no') return false
  const dnt = (readEnv('DO_NOT_TRACK') ?? '').toLowerCase()
  if (dnt === '1' || dnt === 'true') return false
  if (readEnv('CI')) return false

  try {
    const g = globalThis as { __ANYCLAUDE_NO_TELEMETRY__?: boolean; localStorage?: Storage }
    if (g.__ANYCLAUDE_NO_TELEMETRY__ === true) return false
    const v = g.localStorage?.getItem('anyclaude_telemetry')
    if (v === '0' || v === 'off' || v === 'false') return false
  } catch {
    /* localStorage may throw in sandboxed contexts */
  }
  return true
}

function telemetryUrl(opts?: TelemetryOptions): string {
  return opts?.url || readEnv('ANYCLAUDE_TELEMETRY_URL') || DEFAULT_TELEMETRY_URL
}

/** Coarse runtime bucket — never anything machine-identifying. */
export function detectRuntime(): 'browser' | 'webcontainer' | 'bun' | 'node' | 'unknown' {
  const g = globalThis as {
    Bun?: unknown
    process?: { versions?: { node?: string; bun?: string; webcontainer?: string } }
    window?: unknown
    document?: unknown
  }
  // WebContainer sets process.versions.webcontainer.
  if (g.process?.versions?.webcontainer) return 'webcontainer'
  if (typeof g.window !== 'undefined' && typeof g.document !== 'undefined') return 'browser'
  if (g.Bun || g.process?.versions?.bun) return 'bun'
  if (g.process?.versions?.node) return 'node'
  return 'unknown'
}

// A random, NON-identifying id. Persisted in browser localStorage so repeated
// runs on one origin coalesce; per-process otherwise. Not tied to machine/user/IP.
let cachedInstallId: string | null = null
function installId(): string {
  if (cachedInstallId) return cachedInstallId
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage
    if (ls) {
      const existing = ls.getItem('anyclaude_install_id')
      if (existing) return (cachedInstallId = existing)
      const fresh = uuid()
      ls.setItem('anyclaude_install_id', fresh)
      return (cachedInstallId = fresh)
    }
  } catch {
    /* ignore */
  }
  return (cachedInstallId = uuid())
}

/** Keep only booleans + the allowlisted coarse string buckets. Everything else is dropped. */
function safeProps(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(props)) {
    if (typeof v === 'boolean') out[k] = v
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    else if (typeof v === 'string' && ALLOWED_STRING_KEYS.has(k)) out[k] = v.slice(0, 40)
  }
  return out
}

let noticeShown = false
function showNoticeOnce(): void {
  if (noticeShown) return
  noticeShown = true
  try {
    const log = (globalThis as { console?: Console }).console
    log?.error?.(
      '[anyclaude-sdk] Anonymous usage telemetry is on (version + runtime + which features, no code/prompts/repo/keys). ' +
        'Opt out: ANYCLAUDE_TELEMETRY=0 (or DO_NOT_TRACK=1). See TELEMETRY.md.'
    )
  } catch {
    /* ignore */
  }
}

/**
 * Record an anonymous, aggregate event. No-op unless telemetry is enabled AND a
 * collector URL is configured. Never blocks, never throws.
 */
export function track(
  event: string,
  props: Record<string, unknown> = {},
  opts?: TelemetryOptions
): void {
  try {
    if (!telemetryEnabled(opts)) return
    const url = telemetryUrl(opts)
    if (!url) return
    const f = (globalThis as { fetch?: typeof fetch }).fetch
    if (!f) return
    showNoticeOnce()
    const body = JSON.stringify({
      event,
      sdk_version: TELEMETRY_SDK_VERSION,
      runtime: detectRuntime(),
      install: installId(),
      ...safeProps(props),
    })
    void f(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* telemetry must never affect the host app */
  }
}
