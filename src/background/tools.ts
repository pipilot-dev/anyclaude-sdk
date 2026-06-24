// Tools for inspecting and controlling background tasks. They read
// `ctx.background` (a BackgroundTaskManager) which the agent loop injects into
// ToolContext when background tasks are enabled.

import type { Tool, ToolContext } from '../tools/types.js'
import type { BackgroundTaskManager, BgTask } from './manager.js'

/** Read the (optional) background manager off the tool context. */
function mgr(ctx: ToolContext): BackgroundTaskManager | undefined {
  return (ctx as { background?: BackgroundTaskManager }).background
}

function ageMs(task: BgTask): number {
  const end = task.endedAt ?? Date.now()
  return end - task.startedAt
}

const NOT_ENABLED = {
  content: 'Background tasks are not enabled for this session.',
  isError: true,
} as const

export const taskList: Tool = {
  def: {
    type: 'function',
    function: {
      name: 'task_list',
      description:
        'List background tasks with their id, status, description, and age. Use to see what background work is running or finished.',
      parameters: { type: 'object', properties: {} },
    },
  },
  async run(_input, ctx) {
    const m = mgr(ctx)
    if (!m) return { ...NOT_ENABLED }
    const tasks = m.list()
    if (!tasks.length) return { content: 'No background tasks.' }
    const rows = tasks
      .map(
        (t) =>
          `${t.id}  [${t.status}]  ${t.description}  (${Math.round(ageMs(t) / 1000)}s${
            t.error ? `, error: ${t.error}` : ''
          })`
      )
      .join('\n')
    return { content: rows }
  },
}

export const taskOutput: Tool = {
  // Background output can be large; let the loop persist it if needed.
  def: {
    type: 'function',
    function: {
      name: 'task_output',
      description:
        "Read a background task's accumulated output. Optionally pass `since` (a character offset) to fetch only new output since a previous read.",
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'The background task id (e.g. bg_1).' },
          since: {
            type: 'number',
            description: 'Character offset to read from (for incremental polling).',
          },
        },
        required: ['task_id'],
      },
    },
  },
  async run(input, ctx) {
    const m = mgr(ctx)
    if (!m) return { ...NOT_ENABLED }
    const id = String(input.task_id ?? '')
    const task = m.get(id)
    if (!task) return { content: `No background task with id "${id}".`, isError: true }
    const since = typeof input.since === 'number' ? input.since : undefined
    const out = m.output(id, since !== undefined ? { since } : undefined) ?? ''
    const header = `[${task.id}] status=${task.status}${task.error ? ` error=${task.error}` : ''}`
    return { content: out ? `${header}\n${out}` : `${header}\n(no output yet)` }
  },
}

export const taskStop: Tool = {
  def: {
    type: 'function',
    function: {
      name: 'task_stop',
      description: 'Stop (abort) a running background task by id.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'The background task id to stop.' },
        },
        required: ['task_id'],
      },
    },
  },
  async run(input, ctx) {
    const m = mgr(ctx)
    if (!m) return { ...NOT_ENABLED }
    const id = String(input.task_id ?? '')
    const stopped = m.stop(id)
    return stopped
      ? { content: `Stopped background task ${id}.` }
      : { content: `Task ${id} was not running (no such task or already finished).`, isError: true }
  },
}

export const BACKGROUND_TOOLS: Tool[] = [taskList, taskOutput, taskStop]
