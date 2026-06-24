// Shared filesystem helpers used by glob/grep/list_files.
import type { FileSystem } from '../types/index.js'

/** Directories that are skipped during recursive walks by default. */
export const DEFAULT_IGNORE = new Set(['node_modules', '.git', 'dist'])

/** Join two path segments with a single separator, normalizing `.`. */
export function joinPath(base: string, name: string): string {
  if (base === '' || base === '.') return name
  return `${base.replace(/\/+$/, '')}/${name}`
}

export interface WalkEntry {
  /** Path relative to the walk root (POSIX separators). */
  path: string
  isDir: boolean
}

export interface WalkOptions {
  /** Directory names to skip. Defaults to {@link DEFAULT_IGNORE}. */
  ignore?: Set<string>
  /** Hard cap on entries yielded, to bound runaway trees. */
  maxEntries?: number
  signal?: AbortSignal
}

/**
 * Recursively walk a directory tree, yielding files and directories with paths
 * relative to `root`. Directories in the ignore set are pruned. Unreadable
 * directories are skipped silently.
 */
export async function* walk(
  fs: FileSystem,
  root: string,
  opts: WalkOptions = {},
): AsyncGenerator<WalkEntry> {
  const ignore = opts.ignore ?? DEFAULT_IGNORE
  const max = opts.maxEntries ?? 50_000
  let count = 0

  // Iterative BFS to avoid deep recursion and keep ordering stable.
  const queue: string[] = ['']
  while (queue.length > 0) {
    if (opts.signal?.aborted) return
    const rel = queue.shift() as string
    const dirPath = rel === '' ? root : joinPath(root, rel)
    const entries = await fs.readdir(dirPath)
    if (!entries) continue

    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDir) {
        if (ignore.has(entry.name)) continue
        yield { path: childRel, isDir: true }
        queue.push(childRel)
      } else {
        yield { path: childRel, isDir: false }
      }
      if (++count >= max) return
    }
  }
}

/**
 * Translate a glob pattern into a RegExp.
 * Supports `**` (any depth, including zero segments), `*` (within a segment),
 * and `?` (single non-separator char). Other regex metachars are escaped.
 */
export function globToRegExp(pattern: string): RegExp {
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // `**` — match across directory separators.
        i++
        // Consume a trailing slash so `**/foo` also matches `foo`.
        if (pattern[i + 1] === '/') {
          i++
          re += '(?:.*/)?'
        } else {
          re += '.*'
        }
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else if ('\\^$.|+()[]{}'.includes(c)) {
      re += '\\' + c
    } else {
      re += c
    }
  }
  return new RegExp(`^${re}$`)
}
