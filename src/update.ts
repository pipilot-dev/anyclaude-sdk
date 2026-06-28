// Non-blocking, opt-out "you're behind latest" check. It NEVER installs anything,
// NEVER blocks a run, and NEVER throws — it only learns the latest published
// version from the npm registry and lets you act on it (a one-line console hint,
// or your own UI via checkForUpdate()).
//
// Opt out with any of: `ANYCLAUDE_UPDATE_CHECK=0`, `DO_NOT_TRACK=1`, any `CI`,
// `globalThis.__ANYCLAUDE_NO_UPDATE_CHECK__ = true`, or
// browser `localStorage['anyclaude_update_check']='0'`. Disabling telemetry does
// NOT disable this (different concern), but the same CI/DNT switches cover both.

import { SDK_VERSION } from './version.js'

export interface UpdateInfo {
  current: string
  latest: string | null
  outdated: boolean
  error?: string
}

export interface UpdateCheckOptions {
  /** Force-disable for this call. */
  disabled?: boolean
  /** Package name to check. Default 'anyclaude-sdk'. */
  pkg?: string
  /** Current version to compare against. Default the SDK's own version. */
  current?: string
  /** Registry base. Default 'https://registry.npmjs.org'. */
  registry?: string
  /** Min ms between network checks (browser localStorage gate). Default 24h. */
  cacheMs?: number
}

const DEFAULT_PKG = 'anyclaude-sdk'
const DEFAULT_REGISTRY = 'https://registry.npmjs.org'
const DAY = 24 * 60 * 60 * 1000

function readEnv(name: string): string | undefined {
  const p = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  return p?.env?.[name]
}

/** Honor every documented opt-out for the update check. */
export function updateCheckEnabled(opts?: UpdateCheckOptions): boolean {
  if (opts?.disabled) return false
  const flag = (readEnv('ANYCLAUDE_UPDATE_CHECK') ?? '').toLowerCase()
  if (flag === '0' || flag === 'false' || flag === 'off' || flag === 'no') return false
  const dnt = (readEnv('DO_NOT_TRACK') ?? '').toLowerCase()
  if (dnt === '1' || dnt === 'true') return false
  if (readEnv('CI')) return false
  try {
    const g = globalThis as { __ANYCLAUDE_NO_UPDATE_CHECK__?: boolean; localStorage?: Storage }
    if (g.__ANYCLAUDE_NO_UPDATE_CHECK__ === true) return false
    const v = g.localStorage?.getItem('anyclaude_update_check')
    if (v === '0' || v === 'off' || v === 'false') return false
  } catch {
    /* sandboxed localStorage */
  }
  return true
}

/** Parse 'a.b.c' (ignoring any prerelease/build) into [a,b,c]; non-numerics → 0. */
function parts(v: string): [number, number, number] {
  const core = String(v).trim().replace(/^v/, '').split(/[-+]/)[0]
  const [a, b, c] = core.split('.').map((n) => parseInt(n, 10))
  return [a || 0, b || 0, c || 0]
}

/** True if `current` is strictly behind `latest` (semver core compare). */
export function isOutdated(current: string, latest: string): boolean {
  const [a1, b1, c1] = parts(current)
  const [a2, b2, c2] = parts(latest)
  if (a1 !== a2) return a1 < a2
  if (b1 !== b2) return b1 < b2
  return c1 < c2
}

// One network check per process; subsequent calls reuse the in-flight/settled promise.
let inflight: Promise<UpdateInfo> | null = null

function browserThrottled(pkg: string, cacheMs: number): boolean {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage
    if (!ls) return false
    const key = `anyclaude_update_seen_${pkg}`
    const last = parseInt(ls.getItem(key) || '0', 10) || 0
    if (Date.now() - last < cacheMs) return true
    ls.setItem(key, String(Date.now()))
  } catch {
    /* ignore */
  }
  return false
}

/**
 * Check whether a newer version is published. Never throws — on any failure it
 * resolves `{ outdated: false, latest: null, error }`. Memoized per process.
 */
export function checkForUpdate(opts: UpdateCheckOptions = {}): Promise<UpdateInfo> {
  const current = opts.current ?? SDK_VERSION
  const pkg = opts.pkg ?? DEFAULT_PKG
  const base: UpdateInfo = { current, latest: null, outdated: false }

  if (!updateCheckEnabled(opts)) return Promise.resolve(base)
  if (inflight) return inflight

  inflight = (async (): Promise<UpdateInfo> => {
    try {
      if (browserThrottled(pkg, opts.cacheMs ?? DAY)) return base
      const f = (globalThis as { fetch?: typeof fetch }).fetch
      if (!f) return base
      const registry = opts.registry ?? DEFAULT_REGISTRY
      const res = await f(`${registry}/${encodeURIComponent(pkg)}/latest`, {
        headers: { accept: 'application/vnd.npm.install-v1+json, application/json' },
      })
      if (!res.ok) return { ...base, error: `registry ${res.status}` }
      const latest = (await res.json())?.version
      if (typeof latest !== 'string') return { ...base, error: 'no version field' }
      return { current, latest, outdated: isOutdated(current, latest) }
    } catch (e) {
      return { ...base, error: e instanceof Error ? e.message : String(e) }
    }
  })()
  return inflight
}

let notified = false

/**
 * Fire-and-forget: if a newer version is published, print ONE friendly, opt-out
 * console hint (once per process). Never blocks or throws. Safe to call on every
 * run — it self-throttles. Pass a custom logger to route it into your own UI.
 */
export function notifyIfOutdated(
  opts: UpdateCheckOptions & { log?: (msg: string) => void } = {}
): void {
  if (notified || !updateCheckEnabled(opts)) return
  notified = true
  const pkg = opts.pkg ?? DEFAULT_PKG
  void checkForUpdate(opts)
    .then((info) => {
      if (!info.outdated || !info.latest) return
      const log =
        opts.log ??
        ((m: string) => {
          // eslint-disable-next-line no-console
          ;(globalThis.console?.warn ?? (() => {}))(m)
        })
      log(
        `[${pkg}] Update available: ${info.current} → ${info.latest}. ` +
          `Upgrade: npm i ${pkg}@latest · changelog: https://github.com/pipilot-dev/anyclaude-sdk/blob/main/CHANGELOG.md · ` +
          `silence: ANYCLAUDE_UPDATE_CHECK=0`
      )
    })
    .catch(() => {
      /* never affects the host */
    })
}

/** Reset memoized state — for tests only. */
export function __resetUpdateCheck(): void {
  inflight = null
  notified = false
}
