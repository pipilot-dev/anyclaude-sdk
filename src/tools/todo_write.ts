import type { TodoItem } from '../types/index.js'
import type { Tool } from './types.js'

const DESCRIPTION = `Create and manage a structured task list for the current session.

## When to use
- Complex multi-step tasks (3+ distinct steps).
- Non-trivial tasks that benefit from planning.
- When the user provides multiple tasks, or explicitly asks for a todo list.

## When NOT to use
- A single, straightforward, or trivial task.
- Purely conversational/informational requests.

## Rules
- Mark a task in_progress BEFORE starting it; keep only ONE task in_progress at a time.
- Mark a task completed IMMEDIATELY after finishing it — don't batch completions.
- Each todo has \`content\` (imperative, e.g. "Add tests") and optionally \`activeForm\` (present continuous, e.g. "Adding tests").
- Calling this tool replaces the entire todo list with the provided array.`

// Fallback store used when the agent loop doesn't supply ctx.store (e.g. tools
// used standalone). Keeps the tool functional in isolation.
const fallbackStore: { todos: TodoItem[] } = { todos: [] }

const GLYPH: Record<TodoItem['status'], string> = {
  pending: '☐',
  in_progress: '◐',
  completed: '☒',
}

function render(todos: TodoItem[]): string {
  if (!todos.length) return 'Todo list cleared (no items).'
  return todos
    .map((t) => `${GLYPH[t.status] ?? '☐'} ${t.content}`)
    .join('\n')
}

export const todoWrite: Tool = {
  def: {
    type: 'function',
    function: {
      name: 'todo_write',
      description: DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            description: 'The complete, updated todo list (replaces any existing list).',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string', description: 'Imperative task description.' },
                status: {
                  type: 'string',
                  enum: ['pending', 'in_progress', 'completed'],
                  description: 'Current status of the task.',
                },
                activeForm: {
                  type: 'string',
                  description: 'Present-continuous form shown while in progress.',
                },
              },
              required: ['content', 'status'],
            },
          },
        },
        required: ['todos'],
      },
    },
  },
  async run(input, ctx) {
    if (!Array.isArray(input.todos)) {
      return { content: 'Error: `todos` must be an array.', isError: true }
    }

    const todos: TodoItem[] = []
    for (const raw of input.todos as unknown[]) {
      const t = raw as Partial<TodoItem>
      const content = typeof t?.content === 'string' ? t.content : ''
      const status = t?.status
      if (!content) return { content: 'Error: every todo needs a non-empty `content`.', isError: true }
      if (status !== 'pending' && status !== 'in_progress' && status !== 'completed') {
        return { content: `Error: invalid status "${String(status)}" for "${content}".`, isError: true }
      }
      todos.push({
        content,
        status,
        ...(typeof t.activeForm === 'string' ? { activeForm: t.activeForm } : {}),
      })
    }

    const inProgress = todos.filter((t) => t.status === 'in_progress').length
    if (inProgress > 1) {
      return {
        content: `Error: only one task may be in_progress at a time (found ${inProgress}).`,
        isError: true,
      }
    }

    const target = ctx.store ?? fallbackStore
    target.todos = todos

    const counts = {
      pending: todos.filter((t) => t.status === 'pending').length,
      in_progress: inProgress,
      completed: todos.filter((t) => t.status === 'completed').length,
    }
    return {
      content: `${render(todos)}\n\n(${counts.completed} done, ${counts.in_progress} in progress, ${counts.pending} pending)`,
    }
  },
}
