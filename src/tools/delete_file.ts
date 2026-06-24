import type { Tool } from './types.js'

const DESCRIPTION = `Deletes a file or directory from the workspace filesystem (recursive, force).`

export const deleteFile: Tool = {
  def: {
    type: 'function',
    function: {
      name: 'delete_file',
      description: DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to delete.' },
        },
        required: ['path'],
      },
    },
  },
  async run(input, ctx) {
    const path = String(input.path ?? '')
    if (!path) return { content: 'Error: `path` is required.', isError: true }

    try {
      await ctx.fs.deleteFile(path)
    } catch (err) {
      return {
        content: `Error deleting ${path}: ${(err as Error).message}`,
        isError: true,
      }
    }
    ctx.readFiles.delete(path)
    return { content: `Deleted ${path}` }
  },
}
