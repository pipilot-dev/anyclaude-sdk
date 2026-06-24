// Memory management tools. They read `ctx.memory` (a MemoryStore the agent loop
// injects); accessed via a cast so this file compiles standalone.

import type { Tool, ToolContext } from '../tools/types.js'
import type { MemoryStore } from './store.js'
import type { MemoryType } from './types.js'

const TYPES: MemoryType[] = ['user', 'feedback', 'project', 'reference']

function getStore(ctx: ToolContext): MemoryStore | undefined {
  return (ctx as { memory?: MemoryStore }).memory
}

export const memoryWrite: Tool = {
  def: {
    type: 'function',
    function: {
      name: 'memory_write',
      description:
        'Persist a memory across sessions. Use for durable facts worth remembering: who the user is (user), how to work / corrections (feedback), ongoing project goals/constraints (project), or external references (reference). Re-writing an existing name updates it.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Short unique kebab-case slug.' },
          type: { type: 'string', enum: TYPES, description: 'Memory category.' },
          description: { type: 'string', description: 'One-line summary used for recall.' },
          body: { type: 'string', description: 'The full memory content.' },
        },
        required: ['name', 'type', 'description', 'body'],
      },
    },
  },
  async run(input, ctx) {
    const store = getStore(ctx)
    if (!store) return { content: 'Memory is not enabled.', isError: true }
    const name = String(input.name ?? '').trim()
    const type = String(input.type ?? '') as MemoryType
    const description = String(input.description ?? '').trim()
    const body = String(input.body ?? '').trim()
    if (!name || !description || !body || !TYPES.includes(type)) {
      return { content: 'Error: name, type (user|feedback|project|reference), description, and body are required.', isError: true }
    }
    await store.save({ name, type, description, body })
    return { content: `Saved memory "${name}" (${type}).` }
  },
}

export const memoryList: Tool = {
  def: {
    type: 'function',
    function: {
      name: 'memory_list',
      description: 'List persisted memories (optionally filtered by type).',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: TYPES, description: 'Optional filter.' },
        },
        required: [],
      },
    },
  },
  async run(input, ctx) {
    const store = getStore(ctx)
    if (!store) return { content: 'Memory is not enabled.', isError: true }
    const type = input.type ? (String(input.type) as MemoryType) : undefined
    const entries = await store.list(type)
    if (!entries.length) return { content: type ? `No ${type} memories.` : 'No memories stored.' }
    return {
      content:
        `Memories (${entries.length}):\n` +
        entries.map((e) => `  ${e.name} [${e.type}] — ${e.description}`).join('\n'),
    }
  },
}

export const memoryDelete: Tool = {
  def: {
    type: 'function',
    function: {
      name: 'memory_delete',
      description: 'Delete a persisted memory by name.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The memory name to delete.' },
        },
        required: ['name'],
      },
    },
  },
  async run(input, ctx) {
    const store = getStore(ctx)
    if (!store) return { content: 'Memory is not enabled.', isError: true }
    const name = String(input.name ?? '').trim()
    if (!name) return { content: 'Error: `name` is required.', isError: true }
    await store.remove(name)
    return { content: `Deleted memory "${name}".` }
  },
}

export const MEMORY_TOOLS: Tool[] = [memoryWrite, memoryList, memoryDelete]
