import type { Tool } from './types.js'
import { globToRegExp, walk } from './walk.js'

const MAX_RESULTS = 100

const DESCRIPTION = `Finds files matching a glob pattern by walking the workspace tree.

Supports \`**\` (any depth), \`*\` (within a path segment), and \`?\` (single char).
Example patterns: \`**/*.ts\`, \`src/**/*.test.js\`, \`*.json\`.
Returns matching paths relative to the search root (node_modules/.git/dist are ignored).`

export const glob: Tool = {
  def: {
    type: 'function',
    function: {
      name: 'glob',
      description: DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern to match.' },
          path: {
            type: 'string',
            description: 'Directory to search from (default ".").',
          },
        },
        required: ['pattern'],
      },
    },
  },
  async run(input, ctx) {
    const pattern = String(input.pattern ?? '')
    if (!pattern) return { content: 'Error: `pattern` is required.', isError: true }
    const root = input.path ? String(input.path) : '.'

    const re = globToRegExp(pattern)
    const matches: string[] = []
    let truncated = false

    for await (const entry of walk(ctx.fs, root, { signal: ctx.signal })) {
      if (entry.isDir) continue
      if (re.test(entry.path)) {
        matches.push(entry.path)
        if (matches.length >= MAX_RESULTS) {
          truncated = true
          break
        }
      }
    }

    if (matches.length === 0) {
      return { content: `No files match ${pattern} under ${root}.` }
    }
    matches.sort()
    const note = truncated ? `\n\n[truncated to first ${MAX_RESULTS} matches]` : ''
    return { content: matches.join('\n') + note }
  },
}
