import type { Tool } from './types.js'

const DESCRIPTION = `Launch a sub-agent to handle a complex, multi-step task autonomously.

- Provide a short \`description\` (3-5 words) and a detailed \`prompt\` describing exactly what the sub-agent should do.
- Optionally set \`subagent_type\` to select a configured agent; otherwise a general-purpose agent is used.
- The sub-agent runs its own tool loop to completion and returns only its final result — its intermediate steps do not enter this conversation.
- Use this to parallelize or isolate self-contained work (research, broad searches, multi-file changes). For a single quick action, just call the relevant tool directly.`

export const task: Tool = {
  def: {
    type: 'function',
    function: {
      name: 'task',
      description: DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'A short (3-5 word) description of the task.',
          },
          prompt: {
            type: 'string',
            description: 'The detailed task for the sub-agent to perform.',
          },
          subagent_type: {
            type: 'string',
            description: 'Optional name of a configured agent type to use.',
          },
          run_in_background: {
            type: 'boolean',
            description:
              'Run the sub-agent in the background and return immediately with a task id. Poll it with task_output/task_list.',
          },
        },
        required: ['description', 'prompt'],
      },
    },
  },
  async run(input, ctx) {
    if (!ctx.runSubagent) {
      return {
        content: 'Sub-agents are not enabled for this session.',
        isError: true,
      }
    }
    const prompt = String(input.prompt ?? '').trim()
    if (!prompt) return { content: 'Error: `prompt` is required.', isError: true }
    const description = String(input.description ?? '').trim()
    const agentType = input.subagent_type ? String(input.subagent_type) : undefined

    // Background mode: detach via the BackgroundTaskManager and return a handle.
    if (input.run_in_background) {
      if (!ctx.background) {
        return {
          content: 'Background tasks are not enabled for this session.',
          isError: true,
        }
      }
      const id = ctx.background.start(description || 'sub-agent', async (signal, append) => {
        const r = await ctx.runSubagent!({
          description,
          prompt,
          agentType,
          signal, // so task_stop actually aborts the sub-agent
          onProgress: (t) => append(t.endsWith('\n') ? t : t + '\n'), // stream progress to task_output
        })
        return r.text
      })
      return {
        content: `Started background task ${id} (${description || 'sub-agent'}). Use task_output with task_id "${id}" to read its results, or task_list to see status.`,
      }
    }

    const result = await ctx.runSubagent({ description, prompt, agentType })
    return {
      content: result.text || '(sub-agent produced no output)',
      isError: result.isError,
    }
  },
}
