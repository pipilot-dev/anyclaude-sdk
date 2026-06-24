import type { Tool } from './types.js'

const DESCRIPTION = `Applies multiple exact string replacements to a single file in one atomic operation.

- You must read the file with read_file at least once before editing it; otherwise this tool errors.
- Provide an ordered list of edits. Each edit is applied in sequence to the result of the previous one.
- Each \`old_string\` must match the current file contents exactly (including whitespace) and must be unique unless that edit sets \`replace_all\`.
- Edits are all-or-nothing: if any edit fails (not found, not unique, or identical strings), NO changes are written and the failing edit index is reported.
- Prefer this over multiple edit_file calls when making several changes to the same file.`

interface EditOp {
  old_string: string
  new_string: string
  replace_all?: boolean
}

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

export const multiEdit: Tool = {
  def: {
    type: 'function',
    function: {
      name: 'multi_edit',
      description: DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to edit.' },
          edits: {
            type: 'array',
            description: 'Ordered list of edits to apply sequentially and atomically.',
            items: {
              type: 'object',
              properties: {
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
              required: ['old_string', 'new_string'],
            },
          },
        },
        required: ['path', 'edits'],
      },
    },
  },
  async run(input, ctx) {
    const path = String(input.path ?? '')
    if (!path) return { content: 'Error: `path` is required.', isError: true }

    if (!Array.isArray(input.edits) || input.edits.length === 0) {
      return { content: 'Error: `edits` must be a non-empty array.', isError: true }
    }

    if (!ctx.readFiles.has(path)) {
      return {
        content: `Error: you must read ${path} with read_file before editing it.`,
        isError: true,
      }
    }

    const edits = input.edits as EditOp[]
    const original = await ctx.fs.readFile(path)
    if (original === null) {
      return { content: `Error: file not found: ${path}`, isError: true }
    }

    let text = original
    for (let i = 0; i < edits.length; i++) {
      const e = edits[i]
      const oldString = typeof e?.old_string === 'string' ? e.old_string : ''
      const newString = typeof e?.new_string === 'string' ? e.new_string : ''
      const replaceAll = e?.replace_all === true

      if (oldString === newString) {
        return {
          content: `Error: edit #${i + 1}: \`old_string\` and \`new_string\` are identical.`,
          isError: true,
        }
      }

      const occurrences = countOccurrences(text, oldString)
      if (occurrences === 0) {
        return {
          content: `Error: edit #${i + 1}: \`old_string\` not found${
            i > 0 ? ' (after applying earlier edits)' : ''
          }.`,
          isError: true,
        }
      }
      if (!replaceAll && occurrences > 1) {
        return {
          content: `Error: edit #${i + 1}: \`old_string\` is not unique (found ${occurrences} occurrences). Provide more context or set replace_all: true.`,
          isError: true,
        }
      }

      text = replaceAll
        ? text.split(oldString).join(newString)
        : text.replace(oldString, newString)
    }

    try {
      await ctx.fs.writeFile(path, text)
    } catch (err) {
      return {
        content: `Error writing ${path}: ${(err as Error).message}`,
        isError: true,
      }
    }

    return { content: `Applied ${edits.length} edit${edits.length === 1 ? '' : 's'} to ${path}.` }
  },
}
