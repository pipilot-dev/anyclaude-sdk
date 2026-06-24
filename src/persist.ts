// Large-output handling — mirrors Claude Code's tool-result persistence.
//
// When a tool returns more text than the threshold, the full output is written
// to a file in the workspace and the model receives a <persisted-output>
// preview + path instead. The model then pages through the full content with
// read_file (offset/limit). This keeps huge outputs (big greps, verbose builds,
// long fetches) out of the context window while keeping them fully accessible.

import type { FileSystem } from './types/index.js'
import { joinPath } from './tools/walk.js'

/** Default char threshold before a tool result spills to disk (Claude Code uses 50k). */
export const DEFAULT_MAX_RESULT_CHARS = 50_000

/** Bytes of the full output shown inline as a preview. */
export const PREVIEW_CHARS = 2000

/** Directory (relative to cwd) where spilled tool outputs are stored. */
export const TOOL_RESULTS_DIR = '.bcs/tool-results'

export const PERSISTED_OUTPUT_TAG = '<persisted-output>'
export const PERSISTED_OUTPUT_CLOSING_TAG = '</persisted-output>'

function formatSize(chars: number): string {
  if (chars < 1024) return `${chars} chars`
  if (chars < 1024 * 1024) return `${(chars / 1024).toFixed(1)} KB`
  return `${(chars / (1024 * 1024)).toFixed(1)} MB`
}

/** Truncate at a newline boundary near the limit when possible. */
function preview(content: string): { text: string; hasMore: boolean } {
  if (content.length <= PREVIEW_CHARS) return { text: content, hasMore: false }
  const slice = content.slice(0, PREVIEW_CHARS)
  const lastNl = slice.lastIndexOf('\n')
  const cut = lastNl > PREVIEW_CHARS * 0.5 ? slice.slice(0, lastNl) : slice
  return { text: cut, hasMore: true }
}

/**
 * If `content` exceeds `threshold`, write it to a file under the workspace and
 * return a preview message pointing the model at the path. Otherwise returns
 * the content unchanged. Failures fall back to returning the original content.
 */
export async function maybePersistLargeResult(
  content: string,
  toolUseId: string,
  fs: FileSystem,
  cwd: string,
  threshold: number = DEFAULT_MAX_RESULT_CHARS
): Promise<string> {
  if (!Number.isFinite(threshold) || content.length <= threshold) return content

  const relPath = `${TOOL_RESULTS_DIR}/${toolUseId}.txt`
  const absPath = joinPath(cwd, relPath)
  try {
    await fs.writeFile(absPath, content)
  } catch {
    // If we can't persist, leave the content inline (better than losing it).
    return content
  }

  const { text, hasMore } = preview(content)
  return (
    `${PERSISTED_OUTPUT_TAG}\n` +
    `Output too large (${formatSize(content.length)}). Full output saved to: ${absPath}\n` +
    `Read it with read_file (use offset/limit to page through), or grep it for what you need.\n\n` +
    `Preview (first ${formatSize(PREVIEW_CHARS)}):\n` +
    text +
    (hasMore ? '\n...' : '') +
    `\n${PERSISTED_OUTPUT_CLOSING_TAG}`
  )
}
