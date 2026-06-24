import type { Tool } from './types.js'
import { globToRegExp, joinPath, walk } from './walk.js'

const MAX_MATCHES = 200

const DESCRIPTION = `Searches file contents for a regular expression by walking the workspace tree.

- \`pattern\` is a JavaScript regular expression.
- \`glob\` optionally restricts which files are searched (e.g. \`**/*.ts\`).
- \`output_mode\`: "files_with_matches" (default) lists matching paths, "content" shows \`path:line:text\`, "count" shows per-file match counts.
Binary-looking files and node_modules/.git/dist are skipped.`

/**
 * Heuristic: treat content containing a NUL byte (char code 0) as binary.
 * Only the first chunk is scanned to keep this cheap on large files.
 */
function looksBinary(text: string): boolean {
  const limit = Math.min(text.length, 8000)
  for (let i = 0; i < limit; i++) {
    if (text.charCodeAt(i) === 0) return true
  }
  return false
}

export const grep: Tool = {
  def: {
    type: 'function',
    function: {
      name: 'grep',
      description: DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regular expression to search for.' },
          path: { type: 'string', description: 'Directory to search from (default ".").' },
          glob: { type: 'string', description: 'Glob filter for filenames.' },
          case_insensitive: { type: 'boolean', description: 'Case-insensitive match.' },
          output_mode: {
            type: 'string',
            enum: ['content', 'files_with_matches', 'count'],
            description: 'Output format (default "files_with_matches").',
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
    const mode =
      input.output_mode === 'content' || input.output_mode === 'count'
        ? input.output_mode
        : 'files_with_matches'

    let re: RegExp
    try {
      re = new RegExp(pattern, input.case_insensitive ? 'i' : '')
    } catch (err) {
      return { content: `Error: invalid regex: ${(err as Error).message}`, isError: true }
    }
    const globFilter = input.glob ? globToRegExp(String(input.glob)) : null

    const contentLines: string[] = []
    const fileMatches: string[] = []
    const counts: Array<{ path: string; count: number }> = []
    let total = 0
    let truncated = false

    for await (const entry of walk(ctx.fs, root, { signal: ctx.signal })) {
      if (entry.isDir) continue
      if (globFilter && !globFilter.test(entry.path)) continue

      const full = root === '.' ? entry.path : joinPath(root, entry.path)
      const text = await ctx.fs.readFile(full)
      if (text === null || looksBinary(text)) continue

      const lines = text.split('\n')
      let fileCount = 0
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          fileCount++
          total++
          if (mode === 'content' && contentLines.length < MAX_MATCHES) {
            contentLines.push(`${full}:${i + 1}:${lines[i]}`)
          }
          if (total >= MAX_MATCHES) {
            truncated = true
            break
          }
        }
      }
      if (fileCount > 0) {
        fileMatches.push(full)
        counts.push({ path: full, count: fileCount })
      }
      if (truncated) break
    }

    if (total === 0) {
      return { content: `No matches for /${pattern}/ under ${root}.` }
    }
    const note = truncated ? `\n\n[truncated at ${MAX_MATCHES} matches]` : ''

    if (mode === 'content') {
      return { content: contentLines.join('\n') + note }
    }
    if (mode === 'count') {
      const body = counts.map((c) => `${c.path}:${c.count}`).join('\n')
      return { content: body + note }
    }
    fileMatches.sort()
    return { content: fileMatches.join('\n') + note }
  },
}
