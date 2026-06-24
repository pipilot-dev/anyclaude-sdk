// Coordinator/teammate tools: inter-agent messaging + task board CRUD. The
// Mailbox and TaskBoard live on the ToolContext (injected by the agent loop as
// `ctx.mailbox` / `ctx.board`); accessed via casts here so this file compiles
// standalone before the loop wiring lands.

import type { Tool, ToolContext } from '../tools/types.js'
import type { Mailbox } from './mailbox.js'
import type { BoardTask, TaskBoard, TaskStatus } from './taskBoard.js'

function getMailbox(ctx: ToolContext): Mailbox | undefined {
  return (ctx as { mailbox?: Mailbox }).mailbox
}
function getBoard(ctx: ToolContext): TaskBoard | undefined {
  return (ctx as { board?: TaskBoard }).board
}
function agentName(ctx: ToolContext): string {
  return (ctx as { agentName?: string }).agentName ?? 'coordinator'
}

const NOT_ENABLED = { content: 'Teammates are not enabled for this session.', isError: true } as const

function renderTask(t: BoardTask): string {
  const deps = t.blockedBy.length ? ` blockedBy=[${t.blockedBy.join(',')}]` : ''
  return `${t.id} [${t.status}]${t.owner ? ` @${t.owner}` : ''} — ${t.subject}${deps}`
}

export const sendMessage: Tool = {
  def: {
    type: 'function',
    function: {
      name: 'send_message',
      description:
        'Send a message to a teammate (by name) via the shared mailbox. Use to direct workers, hand off context, or coordinate.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient teammate name.' },
          text: { type: 'string', description: 'Message body.' },
        },
        required: ['to', 'text'],
      },
    },
  },
  async run(input, ctx) {
    const mailbox = getMailbox(ctx)
    if (!mailbox) return { ...NOT_ENABLED }
    const to = String(input.to ?? '').trim()
    const text = String(input.text ?? '')
    if (!to || !text) return { content: 'Error: `to` and `text` are required.', isError: true }
    const id = mailbox.send(agentName(ctx), to, text)
    return { content: `Message ${id} sent to ${to}.` }
  },
}

export const taskCreate: Tool = {
  def: {
    type: 'function',
    function: {
      name: 'task_create',
      description:
        'Create a task on the shared board. Set blocked_by to gate this task on prerequisites (their ids).',
      parameters: {
        type: 'object',
        properties: {
          subject: { type: 'string', description: 'Short task title.' },
          description: { type: 'string', description: 'What needs to be done.' },
          owner: { type: 'string', description: 'Assign to a teammate name.' },
          blocked_by: {
            type: 'array',
            items: { type: 'string' },
            description: 'Task ids that must complete first.',
          },
        },
        required: ['subject'],
      },
    },
  },
  async run(input, ctx) {
    const board = getBoard(ctx)
    if (!board) return { ...NOT_ENABLED }
    const subject = String(input.subject ?? '').trim()
    if (!subject) return { content: 'Error: `subject` is required.', isError: true }
    const blockedBy = Array.isArray(input.blocked_by)
      ? (input.blocked_by as unknown[]).map(String)
      : undefined
    const t = board.create({
      subject,
      description: input.description ? String(input.description) : undefined,
      owner: input.owner ? String(input.owner) : undefined,
      blockedBy,
    })
    return { content: `Created ${renderTask(t)}` }
  },
}

export const taskUpdate: Tool = {
  def: {
    type: 'function',
    function: {
      name: 'task_update',
      description: 'Update a board task — status, owner, subject, or description.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Task id.' },
          status: {
            type: 'string',
            enum: ['pending', 'in_progress', 'completed', 'failed'],
            description: 'New status.',
          },
          owner: { type: 'string' },
          subject: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['id'],
      },
    },
  },
  async run(input, ctx) {
    const board = getBoard(ctx)
    if (!board) return { ...NOT_ENABLED }
    const id = String(input.id ?? '')
    const patch: Record<string, unknown> = {}
    if (input.status) patch.status = input.status as TaskStatus
    if (input.owner) patch.owner = String(input.owner)
    if (input.subject) patch.subject = String(input.subject)
    if (input.description) patch.description = String(input.description)
    const t = board.update(id, patch)
    if (!t) return { content: `No such task: ${id}`, isError: true }
    return { content: `Updated ${renderTask(t)}` }
  },
}

export const taskGet: Tool = {
  def: {
    type: 'function',
    function: {
      name: 'task_get',
      description: 'Get one board task by id (full detail).',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Task id.' } },
        required: ['id'],
      },
    },
  },
  async run(input, ctx) {
    const board = getBoard(ctx)
    if (!board) return { ...NOT_ENABLED }
    const t = board.get(String(input.id ?? ''))
    if (!t) return { content: `No such task: ${input.id}`, isError: true }
    const blocked = board.isBlocked(t.id) ? ' (blocked)' : ''
    return {
      content:
        `${renderTask(t)}${blocked}\n` +
        (t.description ? `description: ${t.description}\n` : '') +
        (t.blocks.length ? `blocks: ${t.blocks.join(', ')}` : ''),
    }
  },
}

export const boardList: Tool = {
  def: {
    type: 'function',
    function: {
      name: 'board_list',
      description: 'List tasks on the shared board, optionally filtered by status or owner.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['pending', 'in_progress', 'completed', 'failed'],
          },
          owner: { type: 'string' },
        },
      },
    },
  },
  async run(input, ctx) {
    const board = getBoard(ctx)
    if (!board) return { ...NOT_ENABLED }
    const tasks = board.list({
      status: input.status as TaskStatus | undefined,
      owner: input.owner ? String(input.owner) : undefined,
    })
    if (!tasks.length) return { content: 'Board is empty.' }
    return { content: tasks.map(renderTask).join('\n') }
  },
}

export const TEAM_TOOLS: Tool[] = [sendMessage, taskCreate, taskUpdate, taskGet, boardList]
