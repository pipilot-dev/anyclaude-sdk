// `dispatch_tasks` tool: the coordinator calls this to execute the board. It
// runs the teammate idle-loop, spawning worker sub-agents for each pending,
// unblocked task (dependencies respected, bounded parallelism). Reads
// `ctx.board` + `ctx.runSubagent` (both injected by the agent loop).

import type { Tool, ToolContext } from '../tools/types.js'
import type { BoardTask, TaskBoard } from './taskBoard.js'
import { runTeamLoop } from './runner.js'

type RunSubagent = (opts: {
  description: string
  prompt: string
  agentType?: string
}) => Promise<{ text: string; isError?: boolean }>

export const dispatchTasks: Tool = {
  def: {
    type: 'function',
    function: {
      name: 'dispatch_tasks',
      description:
        'Execute the task board: spawn worker sub-agents for every pending, unblocked task (dependencies respected, run in parallel), looping until the board drains. Call this after creating tasks with task_create.',
      parameters: {
        type: 'object',
        properties: {
          concurrency: { type: 'number', description: 'Max workers in parallel (default 3).' },
        },
      },
    },
  },
  async run(input, ctx: ToolContext) {
    const board = (ctx as { board?: TaskBoard }).board
    const runSubagent = (ctx as { runSubagent?: RunSubagent }).runSubagent
    if (!board || !runSubagent) {
      return { content: 'Teammates/sub-agents are not enabled for this session.', isError: true }
    }
    const spawn = (task: BoardTask) =>
      runSubagent({
        description: task.subject,
        prompt:
          `Complete this task:\n# ${task.subject}\n${task.description ?? ''}\n\n` +
          'When done, your final message should report exactly what you did.',
      })
    const summary = await runTeamLoop(board, spawn, {
      concurrency: typeof input.concurrency === 'number' ? input.concurrency : undefined,
      signal: ctx.signal,
    })
    const lines = board.list().map((t) => `  ${t.id} [${t.status}] — ${t.subject}`)
    return {
      content:
        `Dispatched the board — completed: ${summary.completed.length}, failed: ${summary.failed.length}, rounds: ${summary.rounds}\n` +
        lines.join('\n'),
    }
  },
}
