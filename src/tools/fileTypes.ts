// File-type detection and byte helpers for the read_file subsystem.
// Browser-safe: no node 'fs'/'buffer'/'path' imports — pure string/byte ops.

import type { FileReadLimits } from './types.js'

/**
 * Binary file extensions to skip for text-based reads. Ported from Claude
 * Code's constants/files.ts. `.pdf` and image types are included here, but
 * read_file dispatches those to dedicated handlers before the binary check.
 */
export const BINARY_EXTENSIONS = new Set<string>([
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.tiff', '.tif',
  // Videos
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.flv', '.m4v', '.mpeg', '.mpg',
  // Audio
  '.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma', '.aiff', '.opus',
  // Archives
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar', '.xz', '.z', '.tgz', '.iso',
  // Executables / binaries
  '.exe', '.dll', '.so', '.dylib', '.bin', '.o', '.a', '.obj', '.lib', '.app',
  '.msi', '.deb', '.rpm',
  // Documents
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp',
  // Fonts
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  // Bytecode / VM artifacts
  '.pyc', '.pyo', '.class', '.jar', '.war', '.ear', '.node', '.wasm', '.rlib',
  // Databases
  '.sqlite', '.sqlite3', '.db', '.mdb', '.idx',
  // Design / 3D
  '.psd', '.ai', '.eps', '.sketch', '.fig', '.xd', '.blend', '.3ds', '.max',
  // Flash
  '.swf', '.fla',
  // Lock / profiling data
  '.lockb', '.dat', '.data',
])

export const IMAGE_EXTENSIONS = new Set<string>([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp',
])

export const NOTEBOOK_EXTENSION = '.ipynb'
export const PDF_EXTENSION = '.pdf'

/** Default read caps (mirrors Claude Code: 256 KB / 25k tokens / 20 PDF pages). */
export const DEFAULT_FILE_READ_LIMITS: FileReadLimits = {
  maxSizeBytes: 256 * 1024,
  maxTokens: 25_000,
  maxImageBytes: Math.round(3.75 * 1024 * 1024),
  maxPdfPages: 20,
}

/** Lowercased extension including the leading dot, or '' if none. */
export function extOf(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const base = slash === -1 ? path : path.slice(slash + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return '' // no dot, or dotfile like ".bashrc"
  return base.slice(dot).toLowerCase()
}

export function hasBinaryExtension(path: string): boolean {
  return BINARY_EXTENSIONS.has(extOf(path))
}

export function isImageExtension(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extOf(path))
}

export function isPdfExtension(path: string): boolean {
  return extOf(path) === PDF_EXTENSION
}

export function isNotebookExtension(path: string): boolean {
  return extOf(path) === NOTEBOOK_EXTENSION
}

/** Map an image extension to its MIME type. */
export function imageMediaType(ext: string): string {
  switch (ext) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.bmp':
      return 'image/bmp'
    default:
      return 'application/octet-stream'
  }
}

/** Detect image MIME type from magic bytes, or null if unrecognized. */
export function detectImageFormatFromBytes(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png'
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  // GIF: "GIF8"
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return 'image/gif'
  }
  // BMP: "BM"
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return 'image/bmp'
  }
  // WEBP: "RIFF"...."WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}

/** Heuristic: a NUL byte in the first 8 KB means the file is binary. */
export function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8192)
  for (let i = 0; i < n; i++) {
    if (bytes[i] === 0) return true
  }
  return false
}

/** Rough token estimate (~4 chars/token). */
export function roughTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}

const hasBtoa = typeof btoa === 'function'
const hasAtob = typeof atob === 'function'

/** Base64-encode bytes. Works in browser (btoa) and Node (Buffer). */
export function bytesToBase64(bytes: Uint8Array): string {
  if (hasBtoa) {
    let binary = ''
    const chunk = 0x8000 // 32 KB chunks to avoid call-stack overflow
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    return btoa(binary)
  }
  // Node fallback
  const B = (globalThis as { Buffer?: { from(d: Uint8Array): { toString(enc: string): string } } }).Buffer
  if (B) return B.from(bytes).toString('base64')
  throw new Error('No base64 encoder available in this environment')
}

/** Base64-decode to bytes. Works in browser (atob) and Node (Buffer). */
export function base64ToBytes(b64: string): Uint8Array {
  if (hasAtob) {
    const binary = atob(b64)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  }
  const B = (globalThis as {
    Buffer?: { from(d: string, enc: string): Uint8Array }
  }).Buffer
  if (B) return new Uint8Array(B.from(b64, 'base64'))
  throw new Error('No base64 decoder available in this environment')
}

/** Human-readable byte size. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
