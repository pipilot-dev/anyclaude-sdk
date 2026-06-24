// Small id/uuid helpers, browser-safe with graceful fallback.

function rand(): string {
  // crypto.randomUUID is available in all modern browsers and Node 19+.
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  // Fallback: not cryptographically strong, only used for correlation ids.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    const v = ch === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function uuid(): string {
  return rand()
}

export function toolCallId(): string {
  return 'call_' + rand().replace(/-/g, '').slice(0, 24)
}

export function now(): number {
  return Date.now()
}
