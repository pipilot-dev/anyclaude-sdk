// Pure rendering of memory entries into a system-prompt section.

import type { MemoryEntry, MemoryType } from './types.js'

const MAX_CHARS = 6000
const TYPE_ORDER: MemoryType[] = ['user', 'feedback', 'project', 'reference']

/**
 * Render memory entries into a compact Markdown section for the system prompt.
 * Returns '' for empty input. Caps total length at ~6000 chars, appending a
 * truncation note when entries are dropped.
 */
export function renderMemories(entries: MemoryEntry[]): string {
  if (!entries.length) return ''

  // Group by type, preserving a stable type ordering.
  const byType = new Map<MemoryType, MemoryEntry[]>()
  for (const e of entries) {
    const arr = byType.get(e.type) ?? []
    arr.push(e)
    byType.set(e.type, arr)
  }

  const header =
    '# Memory\n' +
    'The following are persistent memories from prior sessions. Treat them as ' +
    'background context (true when written) — verify against the current code ' +
    'before relying on specifics.\n'

  const blocks: string[] = []
  let used = header.length
  let dropped = 0

  for (const type of TYPE_ORDER) {
    const list = byType.get(type)
    if (!list?.length) continue
    for (const e of list) {
      const block = `\n## ${e.type} — ${e.name}\n${e.description}\n${e.body}\n`
      if (used + block.length > MAX_CHARS) {
        dropped++
        continue
      }
      blocks.push(block)
      used += block.length
    }
  }

  if (!blocks.length) return ''
  let out = header + blocks.join('')
  if (dropped > 0) out += `\n_(+${dropped} more memories omitted to save context)_\n`
  return out
}
