// Fallback parser for models/proxies that emit tool calls as inline TEXT
// instead of native function-calling blocks. Several relays and open models use
// an "XML" tool-call format like:
//
//   <tool_call>
//   <function=write_file>
//   <parameter=path>index.html</parameter>
//   <parameter=content>
//   <!DOCTYPE html> ...
//   </parameter>
//   </function>
//   </tool_call>
//
// Parameters may or may not have closing </parameter> tags, and the wrapper
// <tool_call> may be absent. This parser is tolerant of all those variants and
// also strips the markup out of the user-visible text.

import type { ToolCall } from '../types/index.js'

const FUNCTION_MARKER = /<function\s*=/

export function hasInlineToolCalls(text: string): boolean {
  return FUNCTION_MARKER.test(text)
}

/**
 * Extract inline tool calls from assistant text. Returns the parsed calls and
 * the text with the tool-call markup removed. If none are found, returns the
 * original text and an empty array.
 */
export function parseInlineToolCalls(text: string): {
  calls: ToolCall[]
  cleanedText: string
} {
  if (!text || !FUNCTION_MARKER.test(text)) return { calls: [], cleanedText: text }

  const calls: ToolCall[] = []
  const markerRe = /<function\s*=\s*([^>\s]+)\s*>/g
  const markers: Array<{ name: string; bodyStart: number; markerStart: number }> = []
  let m: RegExpExecArray | null
  while ((m = markerRe.exec(text)) !== null) {
    markers.push({ name: m[1], bodyStart: markerRe.lastIndex, markerStart: m.index })
  }

  for (let i = 0; i < markers.length; i++) {
    const cur = markers[i]
    const end = i + 1 < markers.length ? markers[i + 1].markerStart : text.length
    let body = text.slice(cur.bodyStart, end)
    // Trim at the function/tool_call closers if present.
    body = body.replace(/<\/function>[\s\S]*$/, '').replace(/<\/tool_call>[\s\S]*$/, '')

    const args: Record<string, unknown> = {}
    const parts = body.split(/<parameter\s*=/).slice(1)
    for (const part of parts) {
      const gt = part.indexOf('>')
      if (gt < 0) continue
      const key = part.slice(0, gt).trim()
      let val = part.slice(gt + 1)
      // Value ends at its own closer (or the function/tool_call closer, or the
      // next parameter — already removed by the split).
      val = val
        .replace(/<\/parameter>[\s\S]*$/, '')
        .replace(/<\/function>[\s\S]*$/, '')
        .replace(/<\/tool_call>[\s\S]*$/, '')
      args[key] = trimEdges(val)
    }

    calls.push({
      id: `call_inline_${i}`,
      type: 'function',
      function: { name: cur.name.trim(), arguments: JSON.stringify(args) },
    })
  }

  // Everything from the first tool-call/function marker onward is markup.
  const cut = text.search(/<tool_call>|<function\s*=/)
  const cleanedText = cut >= 0 ? text.slice(0, cut).trim() : text

  return { calls, cleanedText }
}

/** Strip a single leading newline and trailing whitespace from a param value. */
function trimEdges(v: string): string {
  return v.replace(/^\r?\n/, '').replace(/\s+$/, '')
}
