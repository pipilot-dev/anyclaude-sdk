import type { Tool } from './types.js'

const DESCRIPTION = `Read or write session configuration key/value pairs.

actions: "get" (requires key), "set" (requires key + value), "list". Config is session-scoped and visible to subsequent tool calls; use it to remember small preferences or flags during a task.`

export const config: Tool = {
  def: {
    type: 'function',
    function: {
      name: 'config',
      description: DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['get', 'set', 'list'], description: 'Operation to perform.' },
          key: { type: 'string', description: 'Config key (for get/set).' },
          value: { description: 'Value to store (for set). Any JSON value.' },
        },
        required: ['action'],
      },
    },
  },
  async run(input, ctx) {
    if (!ctx.store) return { content: 'Session store unavailable.', isError: true }
    const cfg = (ctx.store.config ??= {})
    const action = String(input.action ?? '')
    const key = input.key != null ? String(input.key) : ''
    if (action === 'list') {
      const keys = Object.keys(cfg)
      return { content: keys.length ? JSON.stringify(cfg, null, 2) : '(empty config)' }
    }
    if (action === 'get') {
      if (!key) return { content: 'Error: `key` is required for get.', isError: true }
      return { content: key in cfg ? JSON.stringify(cfg[key]) : `(unset: ${key})` }
    }
    if (action === 'set') {
      if (!key) return { content: 'Error: `key` is required for set.', isError: true }
      cfg[key] = input.value
      return { content: `Set ${key} = ${JSON.stringify(input.value)}` }
    }
    return { content: `Unknown action "${action}". Use get/set/list.`, isError: true }
  },
}
