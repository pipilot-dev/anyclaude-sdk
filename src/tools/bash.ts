import type { Tool } from './types.js'

const DESCRIPTION = `Executes a shell command in the workspace and returns its combined output (stdout + stderr).

The shell depends on the workspace: a POSIX shell (sh/bash) on Linux/macOS or in WebContainer's jsh, and cmd.exe on Windows. Use commands appropriate to the host OS. The working directory persists between commands; shell state does not.

Prefer the dedicated tools (read_file, write_file, edit_file, glob, grep, list_files) over shell equivalents (cat, sed, find, grep, ls) for a better experience.`

export const bash: Tool = {
  def: {
    type: 'function',
    function: {
      name: 'bash',
      description: DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The bash command to run.' },
          timeout_ms: {
            type: 'number',
            description: 'Optional timeout in milliseconds (default 120000).',
          },
          description: {
            type: 'string',
            description: 'Short human-readable description of what the command does.',
          },
        },
        required: ['command'],
      },
    },
  },
  async run(input, ctx) {
    const command = String(input.command ?? '').trim()
    if (!command) {
      return { content: 'Error: `command` is required.', isError: true }
    }
    const timeout =
      typeof input.timeout_ms === 'number' ? input.timeout_ms : undefined

    let result: { output: string; exitCode: number }
    try {
      result = await ctx.exec.exec(command, timeout)
    } catch (e) {
      const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e)
      return { content: `Failed to run command: ${msg}`, isError: true }
    }
    const { output, exitCode } = result
    if (exitCode !== 0) {
      const body = output || '(no output)'
      return {
        content: `Command exited with code ${exitCode}:\n${body}`,
        isError: true,
      }
    }
    return { content: output || '(command produced no output)' }
  },
}
