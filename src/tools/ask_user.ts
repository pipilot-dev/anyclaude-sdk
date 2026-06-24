// ask_user_question — ports Claude Code's AskUserQuestion. Surfaces a
// multiple-choice question to the user via a host callback (`ctx.askUser`,
// wired from query({ onAskUser })) and returns their selection. Registered only
// when an onAskUser handler is provided; otherwise it degrades gracefully.
import type { Tool, ToolContext, ToolResult } from './types.js'

const DESCRIPTION = `Ask the user a multiple-choice question and wait for their answer. Use ONLY when you hit a decision that's genuinely the user's to make (choosing between distinct approaches, confirming ambiguous scope) and you can't resolve it from the request or sensible defaults. Provide 2-4 concrete, mutually-exclusive options. Prefer acting on a reasonable default over asking.`

export const askUserQuestion: Tool = {
  def: {
    type: 'function',
    function: {
      name: 'ask_user_question',
      description: DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The question to ask the user.' },
          header: { type: 'string', description: 'Very short label/chip for the question (max ~12 chars).' },
          options: {
            type: 'array',
            description: '2-4 options the user can choose from.',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: 'Concise choice text (1-5 words).' },
                description: { type: 'string', description: 'What this option means / its trade-off.' },
              },
              required: ['label'],
            },
          },
          multiSelect: { type: 'boolean', description: 'Allow selecting multiple options.' },
        },
        required: ['question', 'options'],
      },
    },
  },
  async run(input, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.askUser) {
      return {
        content:
          'Interactive questions are unavailable in this environment. Choose the most reasonable option yourself, state the assumption, and continue.',
        isError: true,
      }
    }
    const question = String(input.question ?? '').trim()
    const raw = Array.isArray(input.options) ? input.options : []
    const options = raw.map((o) =>
      typeof o === 'string'
        ? { label: o }
        : { label: String((o as { label?: unknown }).label ?? ''), description: (o as { description?: unknown }).description ? String((o as { description?: unknown }).description) : undefined }
    )
    if (!question || !options.length) return { content: 'Error: `question` and `options` are required.', isError: true }
    const answer = await ctx.askUser({
      question,
      header: input.header ? String(input.header) : undefined,
      options,
      multiSelect: !!input.multiSelect,
    })
    const chosen = Array.isArray(answer) ? answer.join(', ') : String(answer)
    return { content: `User answered "${question}" → ${chosen || '(no selection)'}` }
  },
}
