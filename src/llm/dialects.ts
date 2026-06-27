// Tool-call dialects — recover tool calls that a model emitted as TEXT instead
// of native function-calling blocks. Different open / cheap models speak
// different "dialects" when they don't (or can't) use native tool_calls:
//
//   • xml-function  (vLLM / many relays):
//         <function=write_file><parameter=path>index.html</parameter>...</function>
//   • hermes        (Qwen, Hermes, NousResearch, many Ollama models):
//         <tool_call>{"name":"write_file","arguments":{"path":"index.html"}}</tool_call>
//   • json-fence    (DeepSeek, Mistral, generic):
//         ```json
//         {"name":"write_file","arguments":{"path":"index.html"}}
//         ```
//
// Each dialect is pluggable: a `test` (cheap presence check) + a `parse`
// (extract calls and strip the markup from the visible text). `parseToolCalls`
// tries a list of dialects in order and returns the first that yields calls.
//
// Browser-clean (types only).
import type { ToolCall } from '../types/index.js'

export interface ParsedToolCalls {
  /** Tool calls recovered from the text (empty if none matched). */
  calls: ToolCall[]
  /** The text with tool-call markup removed (safe to show the user). */
  cleanedText: string
}

export interface ToolDialect {
  /** Stable id, e.g. 'xml-function' | 'hermes' | 'json-fence'. */
  name: string
  /** Cheap presence check — does this dialect's markup appear at all? */
  test(text: string): boolean
  /** Extract calls + strip markup. `idBase` seeds generated call ids. */
  parse(text: string, idBase?: number): ParsedToolCalls
}

/** Strip a single leading newline and trailing whitespace from a param value. */
function trimEdges(v: string): string {
  return v.replace(/^\r?\n/, '').replace(/\s+$/, '')
}

// ---------------------------------------------------------------------------
// xml-function — <function=name><parameter=key>value</parameter></function>
// (closing tags optional; wrapper <tool_call> optional). This is the original
// anyclaude inline format and stays first in the default order for back-compat.
// ---------------------------------------------------------------------------
const XML_FUNCTION_MARKER = /<function\s*=/
export const xmlFunctionDialect: ToolDialect = {
  name: 'xml-function',
  test: (text) => XML_FUNCTION_MARKER.test(text),
  parse(text, idBase = 0) {
    if (!text || !XML_FUNCTION_MARKER.test(text)) return { calls: [], cleanedText: text }
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
      body = body.replace(/<\/function>[\s\S]*$/, '').replace(/<\/tool_call>[\s\S]*$/, '')
      const args: Record<string, unknown> = {}
      const parts = body.split(/<parameter\s*=/).slice(1)
      for (const part of parts) {
        const gt = part.indexOf('>')
        if (gt < 0) continue
        const key = part.slice(0, gt).trim()
        let val = part.slice(gt + 1)
        val = val
          .replace(/<\/parameter>[\s\S]*$/, '')
          .replace(/<\/function>[\s\S]*$/, '')
          .replace(/<\/tool_call>[\s\S]*$/, '')
        args[key] = trimEdges(val)
      }
      calls.push({
        id: `call_inline_${idBase + i}`,
        type: 'function',
        function: { name: cur.name.trim(), arguments: JSON.stringify(args) },
      })
    }
    const cut = text.search(/<tool_call>|<function\s*=/)
    const cleanedText = cut >= 0 ? text.slice(0, cut).trim() : text
    return { calls, cleanedText }
  },
}

// ---------------------------------------------------------------------------
// hermes — <tool_call>{"name": "...", "arguments": {...}}</tool_call>
// Accepts "arguments" | "parameters" | "args"; tolerates a missing closing tag.
// Used by Qwen, Hermes/NousResearch, and many Ollama-served models.
// ---------------------------------------------------------------------------
const HERMES_OPEN = /<tool_call>/i
export const hermesDialect: ToolDialect = {
  name: 'hermes',
  test: (text) => HERMES_OPEN.test(text) && text.includes('{'),
  parse(text, idBase = 0) {
    if (!HERMES_OPEN.test(text)) return { calls: [], cleanedText: text }
    const calls: ToolCall[] = []
    const blockRe = /<tool_call>\s*([\s\S]*?)(?:<\/tool_call>|$)/gi
    let m: RegExpExecArray | null
    let i = 0
    while ((m = blockRe.exec(text)) !== null) {
      const obj = extractFirstJsonObject(m[1])
      if (!obj) continue
      const call = jsonToToolCall(obj, idBase + i)
      if (call) {
        calls.push(call)
        i++
      }
    }
    const cut = text.search(HERMES_OPEN)
    const cleanedText = cut >= 0 ? text.slice(0, cut).trim() : text
    return { calls, cleanedText }
  },
}

// ---------------------------------------------------------------------------
// json-fence — a fenced code block whose JSON looks like a tool call:
//   ```json | ```tool_call | ```tool
//   {"name": "...", "arguments": {...}}   (also "tool"/"args"/"parameters")
//   ```
// Conservative: only treats a block as a call when it has BOTH a name key
// (name|tool|function) AND an args key (arguments|args|parameters|input), so
// ordinary JSON the model prints for the user is not misread as a tool call.
// ---------------------------------------------------------------------------
const FENCE_RE = /```(?:json|tool_call|tool)?\s*\n?([\s\S]*?)```/gi
export const jsonFenceDialect: ToolDialect = {
  name: 'json-fence',
  test: (text) => /```/.test(text) && /"(name|tool|function)"\s*:/.test(text),
  parse(text, idBase = 0) {
    const calls: ToolCall[] = []
    let firstMatchIndex = -1
    let m: RegExpExecArray | null
    let i = 0
    while ((m = FENCE_RE.exec(text)) !== null) {
      const obj = extractFirstJsonObject(m[1])
      if (!obj) continue
      const call = jsonToToolCall(obj, idBase + i)
      if (call) {
        if (firstMatchIndex < 0) firstMatchIndex = m.index
        calls.push(call)
        i++
      }
    }
    FENCE_RE.lastIndex = 0
    const cleanedText = firstMatchIndex >= 0 ? text.slice(0, firstMatchIndex).trim() : text
    return { calls, cleanedText }
  },
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Extract params from a tool-tag body: both `<parameter=key>v</parameter>` and direct `<key>v</key>` children. */
function parseTagParams(body: string): Record<string, unknown> {
  const args: Record<string, unknown> = {}
  const pRe = /<parameter\s*=\s*([^>\s]+)\s*>([\s\S]*?)(?:<\/parameter>|<parameter\s*=|$)/gi
  let m: RegExpExecArray | null
  while ((m = pRe.exec(body)) !== null) args[m[1].trim()] = trimEdges(m[2])
  const tRe = /<([a-zA-Z_][\w-]*)\s*>([\s\S]*?)<\/\1>/g
  while ((m = tRe.exec(body)) !== null) {
    const k = m[1]
    if (k === 'parameter' || k in args) continue
    args[k] = trimEdges(m[2])
  }
  return args
}

/**
 * Named-tag tool calls (the Cline/Roo/Aider convention): a tool invoked as
 * `<tool_name><param>value</param></tool_name>` (or `<tool_name/>`). Scoped to
 * the KNOWN tool names so ordinary markup the model writes isn't misread. This
 * is what leaks as raw `<finish>…</finish>` text when a model emulates a custom
 * tool format and the SDK doesn't recognize it.
 */
export function parseNamedTagToolCalls(
  text: string,
  toolNames: string[],
  idBase = 0
): ParsedToolCalls {
  if (!text || !toolNames?.length) return { calls: [], cleanedText: text }
  let best = { idx: -1, name: '', after: -1 }
  for (const name of toolNames) {
    const re = new RegExp('<' + escapeRe(name) + '(?:\\s[^>]*)?/?>', 'i')
    const m = re.exec(text)
    if (m && (best.idx < 0 || m.index < best.idx)) best = { idx: m.index, name, after: m.index + m[0].length }
  }
  if (best.idx < 0) return { calls: [], cleanedText: text }
  const closer = new RegExp('</' + escapeRe(best.name) + '>', 'i')
  const rest = text.slice(best.after)
  const cm = closer.exec(rest)
  const body = cm ? rest.slice(0, cm.index) : rest
  const args = parseTagParams(body)
  return {
    calls: [{ id: `call_inline_${idBase}`, type: 'function', function: { name: best.name, arguments: JSON.stringify(args) } }],
    cleanedText: text.slice(0, best.idx).trim(),
  }
}

/**
 * Remove leaked reasoning / tool-wrapper markup from user-visible text:
 * `<thinking>…</thinking>` blocks and orphan `<tool_call>` / `<function…>` /
 * `<parameter…>` tags that a model emitted as prose. Conservative — only these
 * well-known control tags, which essentially never appear in legitimate output.
 */
export function stripControlTags(text: string): string {
  if (!text || text.indexOf('<') < 0) return text
  return text
    .replace(/<thinking\s*>[\s\S]*?<\/thinking\s*>/gi, '')
    .replace(/<\/?(?:thinking|tool_call|function|parameter|antml:[a-z_]+)(?:\s[^>]*|=[^>]*)?\/?>/gi, '')
    .replace(/[ \t]+(\r?\n)/g, '$1')
    .trim()
}

/** All built-in dialects, keyed by name. */
export const dialects: Record<string, ToolDialect> = {
  'xml-function': xmlFunctionDialect,
  hermes: hermesDialect,
  'json-fence': jsonFenceDialect,
}

/** Default attempt order — xml-function first preserves original behavior. */
export const DEFAULT_DIALECTS = ['xml-function', 'hermes', 'json-fence']

/**
 * Try a list of dialects (by name) against text and return the first that
 * yields tool calls. Falls back to `{ calls: [], cleanedText: text }`.
 */
export function parseToolCalls(
  text: string,
  opts: { dialects?: string[]; idBase?: number; toolNames?: string[] } = {}
): ParsedToolCalls {
  if (!text) return { calls: [], cleanedText: text }
  const order = opts.dialects ?? DEFAULT_DIALECTS
  for (const name of order) {
    const d = dialects[name]
    if (!d || !d.test(text)) continue
    const parsed = d.parse(text, opts.idBase ?? 0)
    if (parsed.calls.length) return { calls: parsed.calls, cleanedText: stripControlTags(parsed.cleanedText) }
  }
  // Named-tag fallback (e.g. `<finish>…</finish>`) — scoped to known tool names.
  if (opts.toolNames?.length) {
    const named = parseNamedTagToolCalls(text, opts.toolNames, opts.idBase ?? 0)
    if (named.calls.length) return { calls: named.calls, cleanedText: stripControlTags(named.cleanedText) }
  }
  // No tool call recognized — still scrub any leaked control/reasoning markup so
  // raw tags never render to the user.
  return { calls: [], cleanedText: stripControlTags(text) }
}

/** True if ANY of the given dialects (default: all) detects tool-call markup. */
export function hasToolCalls(text: string, order: string[] = DEFAULT_DIALECTS): boolean {
  return order.some((n) => dialects[n]?.test(text))
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Find and parse the first balanced top-level `{...}` JSON object in a string. */
function extractFirstJsonObject(s: string): Record<string, unknown> | null {
  const start = s.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        const slice = s.slice(start, i + 1)
        try {
          const v = JSON.parse(slice)
          return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
        } catch {
          return null
        }
      }
    }
  }
  return null
}

/** Coerce a `{name|tool|function, arguments|args|parameters|input}` object into a ToolCall. */
function jsonToToolCall(obj: Record<string, unknown>, idx: number): ToolCall | null {
  // Some emitters wrap as { "tool_call": {...} } or { "function": {name, arguments} }.
  if (obj.tool_call && typeof obj.tool_call === 'object') {
    return jsonToToolCall(obj.tool_call as Record<string, unknown>, idx)
  }
  let name = obj.name ?? obj.tool ?? obj.function
  let rawArgs = obj.arguments ?? obj.args ?? obj.parameters ?? obj.input
  // Nested OpenAI shape: { function: { name, arguments } }
  if (name && typeof name === 'object') {
    const fn = name as Record<string, unknown>
    rawArgs = rawArgs ?? fn.arguments ?? fn.args
    name = fn.name
  }
  if (typeof name !== 'string' || !name) return null
  const argsStr =
    typeof rawArgs === 'string'
      ? rawArgs
      : rawArgs === undefined
        ? '{}'
        : JSON.stringify(rawArgs)
  return {
    id: `call_inline_${idx}`,
    type: 'function',
    function: { name: name.trim(), arguments: argsStr || '{}' },
  }
}
