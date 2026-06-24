import type { Tool } from './types.js'

const DESCRIPTION = `Writes a file to the workspace filesystem, creating parent directories as needed and overwriting any existing file.

Prefer edit_file for modifying existing files; use write_file for new files or full rewrites.`

export const writeFile: Tool = {
  def: {
    type: 'function',
    function: {
      name: 'write_file',
      description: DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to write.' },
          content: { type: 'string', description: 'Full contents to write.' },
        },
        required: ['path', 'content'],
      },
    },
  },
  async run(input, ctx) {
    const path = String(input.path ?? '')
    if (!path) return { content: 'Error: `path` is required.', isError: true }
    const content = typeof input.content === 'string' ? input.content : ''

    try {
      await ctx.fs.writeFile(path, content)
    } catch (err) {
      return {
        content: `Error writing ${path}: ${(err as Error).message}`,
        isError: true,
      }
    }
    // A freshly written file counts as "read" so it can be edited next.
    ctx.readFiles.add(path)
    const bytes = new TextEncoder().encode(content).length
    return { content: `Wrote ${bytes} bytes to ${path}` }
  },
}
