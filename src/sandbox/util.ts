// Small browser-safe helpers shared by the sandbox adapters: base64 codec and
// normalizers that coerce a provider's varied return shapes (string, bytes,
// ArrayBuffer, ReadableStream, or a thunk returning any of those) into a
// concrete string / Uint8Array.

const CHUNK = 0x8000

/** Encode bytes to base64 (browser btoa or Node Buffer), chunked for big inputs. */
export function bytesToBase64(bytes: Uint8Array): string {
  const g = globalThis as { btoa?: (s: string) => string }
  if (typeof g.btoa === 'function') {
    let binary = ''
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
    }
    return g.btoa(binary)
  }
  const B = (globalThis as { Buffer?: { from(d: Uint8Array): { toString(e: string): string } } }).Buffer
  if (B) return B.from(bytes).toString('base64')
  throw new Error('No base64 encoder available')
}

/** Decode base64 to bytes (browser atob or Node Buffer). */
export function base64ToBytes(b64: string): Uint8Array {
  const g = globalThis as { atob?: (s: string) => string }
  if (typeof g.atob === 'function') {
    const binary = g.atob(b64)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  }
  const B = (globalThis as { Buffer?: { from(s: string, e: string): Uint8Array } }).Buffer
  if (B) return new Uint8Array(B.from(b64, 'base64'))
  throw new Error('No base64 decoder available')
}

const decoder = new TextDecoder()
const encoder = new TextEncoder()

type StreamLike = ReadableStream<Uint8Array | string>
type ValueLike = string | Uint8Array | ArrayBuffer | StreamLike | null | undefined
/** A provider value that may be the data directly or a thunk/promise returning it. */
export type MaybeAsync<T> = T | (() => T | Promise<T>) | Promise<T>

async function unwrap<T>(v: MaybeAsync<T>): Promise<T> {
  const r = typeof v === 'function' ? (v as () => T | Promise<T>)() : v
  return await (r as T | Promise<T>)
}

async function readStream(stream: StreamLike): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    const bytes = typeof value === 'string' ? encoder.encode(value) : value
    if (bytes) {
      chunks.push(bytes)
      total += bytes.length
    }
  }
  reader.releaseLock?.()
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

/** Coerce a provider value (possibly async / a stream) into a string. */
export async function toText(value: MaybeAsync<ValueLike>): Promise<string> {
  const v = await unwrap(value)
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (v instanceof Uint8Array) return decoder.decode(v)
  if (v instanceof ArrayBuffer) return decoder.decode(new Uint8Array(v))
  if (typeof (v as StreamLike).getReader === 'function') {
    return decoder.decode(await readStream(v as StreamLike))
  }
  return String(v)
}

/** Coerce a provider value (possibly async / a stream) into bytes. */
export async function toBytes(value: MaybeAsync<ValueLike>): Promise<Uint8Array> {
  const v = await unwrap(value)
  if (v == null) return new Uint8Array()
  if (v instanceof Uint8Array) return v
  if (v instanceof ArrayBuffer) return new Uint8Array(v)
  if (typeof v === 'string') return encoder.encode(v)
  if (typeof (v as StreamLike).getReader === 'function') {
    return readStream(v as StreamLike)
  }
  return encoder.encode(String(v))
}

/** Shell-quote a single argument for safe interpolation into a command string. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}
