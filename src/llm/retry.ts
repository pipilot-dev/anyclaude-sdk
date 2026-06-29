// Shared retry policy for the built-in LLM clients. The engine previously threw
// on the first non-OK response (a single transient 401/429/5xx or a dropped
// socket killed the whole run). This adds bounded, exponential-backoff retries
// with one hard safety rule: a request is only retried if NOTHING has streamed
// to the consumer yet — once tokens (or tool-call deltas) have been emitted we
// can't replay them, so we surface the error instead of double-emitting.

/** What to retry and how. All fields optional; sensible defaults applied. */
export interface RetryPolicy {
  /** Max total attempts (incl. the first). Default 10. Set 1 to disable retries. */
  maxAttempts?: number
  /** Base backoff in ms (first retry waits this long). Default 1000. */
  baseMs?: number
  /** Backoff ceiling in ms. Default 30000 (→ 1→2→4→8→16→30→30…s). */
  maxMs?: number
  /** Add ±jitter (fraction 0–1 of the delay) to avoid thundering herds. Default 0.1. */
  jitter?: number
  /** Override which HTTP statuses are retryable. Default {@link isRetryableStatus}. */
  retryStatus?: (status: number) => boolean
  /** Abort: stops waiting and aborts the loop. Usually the run's signal. */
  signal?: AbortSignal
  /** Observe each retry (for logging / telemetry). Never throws. */
  onRetry?: (info: { attempt: number; delayMs: number; status?: number; reason: string }) => void
}

/**
 * Default retryable HTTP statuses. Includes transient auth (401) because some
 * gateways/proxies emit a brief 401 during key-refresh or cold-start; if your
 * endpoint returns a *permanent* 401 for a bad key, override `retryStatus` to
 * exclude it. 408 (timeout), 409 (conflict), 429 (rate limit), and all 5xx.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 401 || status === 408 || status === 409 || status === 429 || status >= 500
}

/** A non-OK HTTP response the retry loop can classify by status. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Parsed from a Retry-After header, if present (ms). */
    public readonly retryAfterMs?: number
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

/** Wrap an error so the retry loop will NOT retry it (e.g. a mid-stream drop
 *  after bytes were already delivered to the consumer). */
export function noRetry(err: unknown): Error {
  const e = err instanceof Error ? err : new Error(String(err))
  ;(e as { __noRetry?: boolean }).__noRetry = true
  return e
}

function isAbort(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError'
}

/** Parse a Retry-After header (delta-seconds or HTTP-date) into ms, if usable. */
export function parseRetryAfter(headers: Headers | undefined, nowMs: number): number | undefined {
  const v = headers?.get?.('retry-after')
  if (!v) return undefined
  const secs = Number(v)
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000)
  const at = Date.parse(v)
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : undefined
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function classify(
  err: unknown,
  retryStatus: (s: number) => boolean
): { retryable: boolean; status?: number; retryAfterMs?: number; reason: string } {
  if (isAbort(err)) return { retryable: false, reason: 'aborted' }
  if (err && typeof err === 'object' && (err as { __noRetry?: boolean }).__noRetry) {
    return { retryable: false, reason: 'mid-stream (already delivered)' }
  }
  if (err instanceof HttpError) {
    return {
      retryable: retryStatus(err.status),
      status: err.status,
      retryAfterMs: err.retryAfterMs,
      reason: `http ${err.status}`,
    }
  }
  // A thrown fetch (network error / dropped socket before any bytes) — retryable.
  if (err instanceof TypeError || (err instanceof Error && /fetch|network|socket|ECONN|terminated|aborted without/i.test(err.message))) {
    return { retryable: true, reason: 'network' }
  }
  return { retryable: false, reason: 'non-retryable' }
}

/**
 * Run `attempt` with bounded exponential backoff. `attempt` should perform the
 * whole request→stream and throw {@link HttpError} for non-OK responses, a plain
 * network error for pre-stream drops (retryable), or {@link noRetry}(err) once it
 * has streamed anything (so it won't be retried). Returns the first success.
 */
export async function withRetry<T>(
  attempt: (attemptIndex: number) => Promise<T>,
  policy: RetryPolicy = {}
): Promise<T> {
  const max = Math.max(1, policy.maxAttempts ?? 10)
  const base = policy.baseMs ?? 1000
  const cap = policy.maxMs ?? 30_000
  const jitter = policy.jitter ?? 0.1
  const retryStatus = policy.retryStatus ?? isRetryableStatus

  let lastErr: unknown
  for (let i = 0; i < max; i++) {
    if (policy.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      return await attempt(i)
    } catch (err) {
      lastErr = err
      const c = classify(err, retryStatus)
      if (!c.retryable || i >= max - 1) throw err
      // Honor Retry-After when the server gave one; else exponential, capped.
      const expo = Math.min(base * 2 ** i, cap)
      const wait = c.retryAfterMs != null ? Math.min(Math.max(c.retryAfterMs, 0), cap) : expo
      // Full-ish jitter: wait ± jitter*wait, varied per attempt (no Math.random
      // needed for determinism — derive from attempt index).
      const j = jitter > 0 ? wait * jitter * (((i % 3) - 1) / 1) : 0
      const delay = Math.max(0, Math.round(wait + j))
      policy.onRetry?.({ attempt: i + 1, delayMs: delay, status: c.status, reason: c.reason })
      await sleep(delay, policy.signal)
    }
  }
  throw lastErr
}

/** Resolve the effective policy from a client option (`false` disables retries). */
export function resolveRetry(opt: RetryPolicy | boolean | undefined): RetryPolicy {
  if (opt === false) return { maxAttempts: 1 }
  if (opt === true || opt == null) return {}
  return opt
}
