// Shared POSIX-style path utilities (browser-safe, no node:path dependency).
// Used by the persistent filesystems and sandbox adapters so path handling is
// consistent across the SDK.

/** Collapse `.`/`..` segments and duplicate slashes. Preserves leading `/`. */
export function normalizePath(p: string): string {
  const isAbs = p.startsWith('/')
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop()
      else if (!isAbs) out.push('..')
    } else {
      out.push(seg)
    }
  }
  return (isAbs ? '/' : '') + out.join('/')
}

/** Join segments with `/` and normalize. */
export function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join('/'))
}

/** Resolve `p` against `cwd` when relative; normalize either way. */
export function resolvePath(cwd: string, p: string): string {
  if (p.startsWith('/')) return normalizePath(p)
  return normalizePath(`${cwd}/${p}`)
}

/** Directory portion of a path (like POSIX dirname). */
export function dirname(p: string): string {
  const n = normalizePath(p)
  const i = n.lastIndexOf('/')
  if (i < 0) return '.'
  if (i === 0) return '/'
  return n.slice(0, i)
}

/** Final path segment (like POSIX basename). */
export function basename(p: string): string {
  const n = normalizePath(p)
  const i = n.lastIndexOf('/')
  return i < 0 ? n : n.slice(i + 1)
}

/** Lowercased extension including the dot (e.g. ".ts"), or "" if none. */
export function extname(p: string): string {
  const base = basename(p)
  const i = base.lastIndexOf('.')
  return i > 0 ? base.slice(i).toLowerCase() : ''
}

/** Split an absolute/relative path into its non-empty segments. */
export function segments(p: string): string[] {
  return normalizePath(p)
    .split('/')
    .filter((s) => s && s !== '.')
}

/** Every ancestor directory of `p`, from `/` (or first segment) down to the parent. */
export function ancestors(p: string): string[] {
  const segs = segments(p)
  const isAbs = normalizePath(p).startsWith('/')
  const out: string[] = []
  let cur = isAbs ? '' : ''
  for (let i = 0; i < segs.length - 1; i++) {
    cur = cur + '/' + segs[i]
    out.push(normalizePath((isAbs ? '' : '') + cur))
  }
  return isAbs ? out.map((a) => (a.startsWith('/') ? a : '/' + a)) : out
}
