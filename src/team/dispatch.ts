// `dispatch_tasks` tool: the coordinator calls this to execute the board. It
// runs the teammate idle-loop, spawning worker sub-agents for each pending,
// unblocked task (dependencies respected, bounded parallelism). Reads
// `ctx.board` + `ctx.runSubagent` (both injected by the agent loop).

import type { Tool, ToolContext } from '../tools/types.js'
import type { BoardTask, TaskBoard } from './taskBoard.js'
import type { BackgroundTaskManager } from '../background/manager.js'
import { runTeamLoop } from './runner.js'

type RunSubagent = (opts: {
  description: string
  prompt: string
  agentType?: string
  name?: string
}) => Promise<{ text: string; isError?: boolean }>

export const dispatchTasks: Tool = {
  def: {
    type: 'function',
    function: {
      name: 'dispatch_tasks',
      description:
        'Execute the task board: spawn worker sub-agents for every pending, unblocked task (dependencies respected, run in parallel), looping until the board drains. Call this after creating tasks with task_create. Set background:true to return immediately and let the workers run while you keep control — then poll board_list/task_get to monitor and send_message to a running worker (worker:<taskId>) to redirect it mid-task.',
      parameters: {
        type: 'object',
        properties: {
          concurrency: { type: 'number', description: 'Max workers in parallel (default 3).' },
          background: {
            type: 'boolean',
            description:
              'Run the dispatch detached and return immediately (requires background tasks enabled). You stay free to monitor the board and message running workers while they work.',
          },
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
    const spawn = (task: BoardTask) => {
      // Give each worker a unique, addressable name and reflect it as the task
      // owner, so the coordinator can dispatch a message to this specific
      // running worker (delivered on its next tool round via the mailbox).
      const name = `worker:${task.id}`
      board.update(task.id, { owner: name })
      return runSubagent({
        description: task.subject,
        name,
        prompt:
          `You are teammate "${name}". Complete this task:\n# ${task.subject}\n${task.description ?? ''}\n\n` +
          'New instructions from the coordinator may arrive mid-task as `[Team messages]` — adapt when they do. ' +
          'When done, your final message should report exactly what you did.',
      })
    }
    const concurrency = typeof input.concurrency === 'number' ? input.concurrency : undefined

    // Background mode: kick the team loop off detached via the background task
    // manager and return immediately, so the coordinator keeps control to poll
    // the board and message running workers while they work.
    if (input.background) {
      const background = (ctx as { background?: BackgroundTaskManager }).background
      if (!background) {
        return {
          content:
            'background:true requires background tasks enabled (query({ background: true })).',
          isError: true,
        }
      }
      const pending = board.list({ status: 'pending' }).length
      const taskId = background.start('dispatch team board', async (signal) => {
        const s = await runTeamLoop(board, spawn, { concurrency, signal })
        return `team dispatch finished — completed: ${s.completed.length}, failed: ${s.failed.length}, rounds: ${s.rounds}`
      })
      return {
        content:
          `Dispatched ${pending} task(s) in the background as ${taskId}. You keep control: ` +
          `poll board_list / task_get to monitor, send_message to worker:<taskId> to redirect a running worker, ` +
          `and task_output ${taskId} for the final summary.`,
      }
    }

    const summary = await runTeamLoop(board, spawn, { concurrency, signal: ctx.signal })
    const lines = board.list().map((t) => `  ${t.id} [${t.status}] — ${t.subject}`)
    return {
      content:
        `Dispatched the board — completed: ${summary.completed.length}, failed: ${summary.failed.length}, rounds: ${summary.rounds}\n` +
        lines.join('\n'),
    }
  },
}
