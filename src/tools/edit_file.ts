import type { Tool } from './types.js'

const DESCRIPTION = `Performs an exact string replacement in a file.

- You must read the file with read_file at least once before editing it; otherwise this tool errors.
- \`old_string\` must match the file contents exactly (including whitespace) and must be unique unless \`replace_all\` is set.
- If \`old_string\` is not unique, the edit fails — provide more surrounding context, or set \`replace_all: true\` to replace every occurrence.`

/** Count non-overlapping occurrences of needle in haystack. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0
  let count = 0
  let idx = haystack.indexOf(needle)
  while (idx !== -1) {
    count++
    idx = haystack.indexOf(needle, idx + needle.length)
  }
  return count
}

export const editFile: Tool = {
  def: {
    type: 'function',
    function: {
      name: 'edit_file',
      description: DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to edit.' },
          old_string: { type: 'string', description: 'Exact text to find.' },
          new_string: {
            type: 'string',
            description: 'Replacement text (must differ from old_string).',
          },
          replace_all: {
            type: 'boolean',
            description: 'Replace every occurrence instead of requiring uniqueness.',
          },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  async run(input, ctx) {
    const path = String(input.path ?? '')
    if (!path) return { content: 'Error: `path` is required.', isError: true }

    if (!ctx.readFiles.has(path)) {
      return {
        content: `Error: you must read ${path} with read_file before editing it.`,
        isError: true,
      }
    }

    const oldString = typeof input.old_string === 'string' ? input.old_string : ''
    const newString = typeof input.new_string === 'string' ? input.new_string : ''
    const replaceAll = input.replace_all === true

    if (oldString === newString) {
      return {
        content: 'Error: `old_string` and `new_string` are identical.',
        isError: true,
      }
    }

    const text = await ctx.fs.readFile(path)
    if (text === null) {
      return { content: `Error: file not found: ${path}`, isError: true }
    }

    const occurrences = countOccurrences(text, oldString)
    if (occurrences === 0) {
      return {
        content: `Error: \`old_string\` not found in ${path}.`,
        isError: true,
      }
    }
    if (!replaceAll && occurrences > 1) {
      return {
        content: `Error: \`old_string\` is not unique in ${path} (found ${occurrences} occurrences). Provide more context or set replace_all: true.`,
        isError: true,
      }
    }

    const updated = replaceAll
      ? text.split(oldString).join(newString)
      : text.replace(oldString, newString)

    try {
      await ctx.fs.writeFile(path, updated)
    } catch (err) {
      return {
        content: `Error writing ${path}: ${(err as Error).message}`,
        isError: true,
      }
    }

    const replaced = replaceAll ? occurrences : 1
    return { content: `Edited ${path} (${replaced} replacement${replaced === 1 ? '' : 's'}).` }
  },
}
