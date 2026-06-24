// Host executors for the agent's CLIENT TOOLS. The server declares bash +
// the file tools but never runs them; the browser runs them HERE, against a
// real WebContainer, and anyclaude-react feeds the results back to the server.
import type { WebContainer } from '@webcontainer/api'
import type { ClientToolMap } from 'anyclaude-react'

const str = (v: unknown): string => (v == null ? '' : String(v))

/** Build the tool name → executor map bound to one booted WebContainer. */
export function makeWebContainerTools(wc: WebContainer): ClientToolMap {
  return {
    // Run a command in a real `jsh` shell and capture its combined output.
    bash: async (input) => {
      const proc = await wc.spawn('jsh', ['-c', str(input.command)])
      let out = ''
      await proc.output.pipeTo(
        new WritableStream<string>({
          write(chunk) {
            out += chunk
          },
        })
      )
      const code = await proc.exit
      return { content: out + (code ? `\n[exit ${code}]` : ''), is_error: code !== 0 }
    },

    write_file: async (input) => {
      const path = str(input.path)
      const content = str(input.content)
      const dir = path.split('/').slice(0, -1).join('/')
      if (dir) {
        try {
          await wc.fs.mkdir(dir, { recursive: true })
        } catch {
          /* dir exists */
        }
      }
      await wc.fs.writeFile(path, content)
      return { content: `Wrote ${content.length} bytes to ${path}` }
    },

    read_file: async (input) => {
      try {
        return { content: await wc.fs.readFile(str(input.path), 'utf-8') }
      } catch (e) {
        return { content: `Error: ${e instanceof Error ? e.message : String(e)}`, is_error: true }
      }
    },

    list_files: async (input) => {
      const dir = str(input.path) || '.'
      try {
        const entries = (await wc.fs.readdir(dir, { withFileTypes: true })) as Array<{
          name: string
          isDirectory(): boolean
        }>
        return {
          content: entries.map((e) => e.name + (e.isDirectory() ? '/' : '')).join('\n') || '(empty)',
        }
      } catch (e) {
        return { content: `Error: ${e instanceof Error ? e.message : String(e)}`, is_error: true }
      }
    },

    edit_file: async (input) => {
      const path = str(input.path)
      try {
        const current = await wc.fs.readFile(path, 'utf-8')
        const next = current.replace(str(input.old_string), str(input.new_string))
        if (next === current) return { content: `No match for old_string in ${path}`, is_error: true }
        await wc.fs.writeFile(path, next)
        return { content: `Edited ${path}` }
      } catch (e) {
        return { content: `Error: ${e instanceof Error ? e.message : String(e)}`, is_error: true }
      }
    },
  }
}
