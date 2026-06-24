// Parse a skill markdown document into a Skill. Hand-parses a simple
// `key: value` YAML-ish frontmatter block (no yaml dependency).

import type { Skill } from './types.js'

const FRONTMATTER = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

/** Strip surrounding single/double quotes from a frontmatter value. */
function unquote(v: string): string {
  const t = v.trim()
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    return t.slice(1, -1)
  }
  return t
}

/**
 * Parse a markdown skill. Recognizes a leading `---`-delimited frontmatter
 * block with `name`, `description`, and `argument-hint`/`argumentHint` keys.
 * Falls back to `fallbackName` and the first non-empty body line when absent.
 */
export function parseSkill(markdown: string, fallbackName = 'skill'): Skill {
  const src = markdown ?? ''
  const m = src.match(FRONTMATTER)
  let meta: Record<string, string> = {}
  let body = src

  if (m) {
    body = m[2] ?? ''
    for (const line of m[1].split(/\r?\n/)) {
      const idx = line.indexOf(':')
      if (idx <= 0) continue
      const key = line.slice(0, idx).trim().toLowerCase()
      meta[key] = unquote(line.slice(idx + 1))
    }
  }

  const firstLine = body
    .split(/\r?\n/)
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .find((l) => l.length > 0)

  const name = (meta['name'] || fallbackName).trim()
  const description = (meta['description'] || firstLine || name).trim()
  const argumentHint = (meta['argument-hint'] || meta['argumenthint'] || '').trim() || undefined

  return { name, description, body: body.trim(), argumentHint }
}
