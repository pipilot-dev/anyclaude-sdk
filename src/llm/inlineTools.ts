// Back-compat shim for the inline tool-call parser. The real implementation
// now lives in ./dialects.ts as a set of pluggable dialects (xml-function,
// hermes, json-fence). `parseInlineToolCalls` / `hasInlineToolCalls` are kept
// as stable, broadened aliases so existing imports keep working.
//
// `parseInlineToolCalls` tries ALL built-in dialects (xml-function first, which
// preserves the original behavior); `hasInlineToolCalls` is true if any dialect
// detects markup.
import type { ToolCall } from '../types/index.js'
import { hasToolCalls, parseToolCalls } from './dialects.js'

export function hasInlineToolCalls(text: string): boolean {
  return hasToolCalls(text)
}

/**
 * Extract inline tool calls from assistant text across all built-in dialects.
 * Returns the parsed calls and the text with the tool-call markup removed.
 */
export function parseInlineToolCalls(text: string): {
  calls: ToolCall[]
  cleanedText: string
} {
  return parseToolCalls(text)
}
