import type { Tool } from './types.js'

const ENTER_DESC = `Enter plan mode: research and design WITHOUT making changes.

While in plan mode, mutating tools (write_file, edit_file, bash that changes state, etc.) are blocked. Use read-only tools to investigate, then present a clear plan and call exit_plan_mode to proceed.`

const EXIT_DESC = `Exit plan mode and present your plan.

Pass the finalized \`plan\` (markdown). After this, mutating tools are allowed again so you can execute.`

export const enterPlanMode: Tool = {
  def: {
    type: 'function',
    function: {
      name: 'enter_plan_mode',
      description: ENTER_DESC,
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  async run(_input, ctx) {
    if (!ctx.planMode) return { content: 'Plan mode is not available in this session.', isError: true }
    ctx.planMode.active = true
    return { content: 'Entered plan mode. Mutating tools are disabled; investigate with read-only tools, then call exit_plan_mode with your plan.' }
  },
}

export const exitPlanMode: Tool = {
  def: {
    type: 'function',
    function: {
      name: 'exit_plan_mode',
      description: EXIT_DESC,
      parameters: {
        type: 'object',
        properties: { plan: { type: 'string', description: 'The finalized plan (markdown).' } },
        required: [],
      },
    },
  },
  async run(input, ctx) {
    if (!ctx.planMode) return { content: 'Plan mode is not available in this session.', isError: true }
    ctx.planMode.active = false
    const plan = String(input.plan ?? '').trim()
    return { content: `Exited plan mode. Mutating tools are enabled.${plan ? '\n\nPlan:\n' + plan : ''}` }
  },
}

export const PLAN_MODE_TOOLS: Tool[] = [enterPlanMode, exitPlanMode]
