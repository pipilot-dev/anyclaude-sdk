import type { Tool } from './types.js'

const DESCRIPTION = `Searches the available tools by keyword and returns the best matches (name + description).

Use this to discover which tool fits a task when many tools are loaded (e.g. lots of MCP tools). Returns ranked matches; then call the chosen tool directly.`

export const toolSearch: Tool = {
  def: {
    type: 'function',
    function: {
      name: 'tool_search',
      description: DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keywords describing what you want to do.' },
          limit: { type: 'number', description: 'Max results (default 8).' },
        },
        required: ['query'],
      },
    },
  },
  async run(input, ctx) {
    const index = ctx.toolIndex ?? []
    if (!index.length) return { content: 'No tool index available.', isError: true }
    const q = String(input.query ?? '').toLowerCase().trim()
    const terms = q.split(/\s+/).filter(Boolean)
    const limit = Math.min(Math.max(Number(input.limit) || 8, 1), 25)
    const scored = index
      .map((t) => {
        const hay = (t.name + ' ' + t.description).toLowerCase()
        let score = 0
        for (const term of terms) {
          if (t.name.toLowerCase().includes(term)) score += 3
          else if (hay.includes(term)) score += 1
        }
        return { t, score }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
    if (!scored.length) return { content: `No tools matched "${q}".` }
    return {
      content:
        `Matching tools for "${q}":\n` +
        scored.map(({ t }) => `  ${t.name} — ${t.description.split('\n')[0]}`).join('\n'),
    }
  },
}
