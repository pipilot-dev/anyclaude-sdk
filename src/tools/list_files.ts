import type { Tool } from './types.js'

const DESCRIPTION = `Lists the entries of a directory in the workspace.

Returns a sorted listing with directories suffixed by \`/\`. Defaults to the workspace root.`

export const listFiles: Tool = {
  def: {
    type: 'function',
    function: {
      name: 'list_files',
      description: DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory to list (default ".").',
          },
        },
        required: [],
      },
    },
  },
  async run(input, ctx) {
    const path = input.path ? String(input.path) : '.'
    const entries = await ctx.fs.readdir(path)
    if (!entries) {
      return { content: `Error: directory not found: ${path}`, isError: true }
    }
    if (entries.length === 0) {
      return { content: `(empty directory: ${path})` }
    }

    // Directories first, then files; each group alphabetized.
    const sorted = [...entries].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    const listing = sorted
      .map((e) => (e.isDir ? `${e.name}/` : e.name))
      .join('\n')
    return { content: listing }
  },
}
