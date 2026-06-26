// Conversation compaction: summarize a long transcript into a compact form so
// the context window doesn't overflow. Used by auto-compaction in the agent
// loop (and shareable with the /compact slash command).

import type { ChatMsg } from './types/index.js'

/** Rough token estimate for a transcript (≈4 chars/token). */
export function estimateTokens(history: ChatMsg[]): number {
  let chars = 0
  for (const m of history) {
    chars += typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length
    if (m.tool_calls) chars += JSON.stringify(m.tool_calls).length
  }
  return Math.round(chars / 4)
}

/** Render a transcript (excluding the system message) as plain text. */
function transcript(history: ChatMsg[]): string {
  return history
    .slice(1)
    .map((m) => {
      const body =
        typeof m.content === 'string'
          ? m.content
          : m.content
              .map((b) =>
                b.type === 'text'
                  ? b.text
                  : b.type === 'tool_use'
                    ? `[tool_use ${b.name} ${JSON.stringify(b.input)}]`
                    : b.type === 'tool_result'
                      ? `[tool_result ${typeof b.content === 'string' ? b.content : '...'}]`
                      : `[${b.type}]`
              )
              .join('\n')
      const calls = m.tool_calls?.length
        ? ' ' + m.tool_calls.map((c) => `[call ${c.function.name}(${c.function.arguments})]`).join(' ')
        : ''
      return `${m.role.toUpperCase()}: ${body}${calls}`
    })
    .join('\n\n')
}

interface SummarizerLLM {
  streamChat(
    messages: ChatMsg[],
    opts: { model?: string; signal?: AbortSignal; onToken: (d: string) => void }
  ): Promise<{ text: string }>
}

/**
 * Summarize `history` into a new transcript `[systemMsg, { user: summary }]`.
 * Returns null if there's nothing to compact or the LLM produced no summary.
 */
export async function summarizeHistory(
  history: ChatMsg[],
  llm: SummarizerLLM,
  opts: { model?: string; signal?: AbortSignal; focus?: string } = {}
): Promise<ChatMsg[] | null> {
  if (history.length <= 2) return null
  const instruction =
    'Summarize the following conversation transcript concisely but completely. ' +
    'Preserve: the user’s goals, key decisions, files created/edited (with paths), ' +
    'important findings, and any unfinished work or next steps. Use short sections.' +
    (opts.focus ? `\nPay special attention to: ${opts.focus}` : '')
  const messages: ChatMsg[] = [
    { role: 'system', content: 'You are a precise conversation summarizer.' },
    { role: 'user', content: `${instruction}\n\n---\n${transcript(history)}` },
  ]
  let summary = ''
  try {
    const res = await llm.streamChat(messages, {
      model: opts.model,
      signal: opts.signal,
      onToken: () => {},
    })
    summary = res.text?.trim() ?? ''
  } catch {
    return null
  }
  if (!summary) return null
  return [history[0], { role: 'user', content: `Summary of the conversation so far:\n${summary}` }]
}

/**
 * Window-aware compaction: keep the most recent `keepRecent` messages VERBATIM
 * and summarize only the older prefix into one summary message. Far less lossy
 * than `summarizeHistory` (which collapses the entire transcript) — recent turns
 * stay intact while old context is condensed. Returns a new history, or the
 * original array unchanged if there isn't enough to compact.
 *
 *   if (estimateTokens(history) > limit) history = await compactWithWindow(history, llm, { keepRecent: 8 })
 */
export async function compactWithWindow(
  history: ChatMsg[],
  llm: SummarizerLLM,
  opts: { keepRecent?: number; model?: string; signal?: AbortSignal; focus?: string } = {}
): Promise<ChatMsg[]> {
  const keepRecent = Math.max(2, opts.keepRecent ?? 8)
  if (history.length <= keepRecent + 2) return history
  // Cut boundary for the verbatim window; don't start it on an orphan tool
  // result (pull its preceding assistant turn into the window).
  let cut = history.length - keepRecent
  while (cut > 1 && history[cut]?.role === 'tool') cut--
  const older = history.slice(0, cut) // includes the system message at [0]
  const recent = history.slice(cut)
  const summarized = await summarizeHistory(older, llm, opts)
  if (!summarized) return history
  return [summarized[0], summarized[1], ...recent]
}
