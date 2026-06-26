// The starter project mounted into the WebContainer. Deliberately zero-dependency
// (a tiny Node static server) so the dev server is ready instantly — no `npm
// install` wait. The agent edits index.html; click Refresh to see changes.
import type { FileSystemTree } from '@webcontainer/api'

export const starterFiles: FileSystemTree = {
  'package.json': {
    file: {
      contents: JSON.stringify(
        {
          name: 'app',
          type: 'module',
          scripts: { dev: 'node server.js' },
        },
        null,
        2
      ),
    },
  },
  'server.js': {
    file: {
      contents: `import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'

const types = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.json':'application/json', '.svg':'image/svg+xml' }

http.createServer(async (req, res) => {
  let path = decodeURIComponent((req.url || '/').split('?')[0])
  if (path === '/' ) path = '/index.html'
  try {
    const body = await readFile('.' + path)
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404, { 'content-type': 'text/html' })
    res.end('<h1>404</h1><p>' + path + ' not found</p>')
  }
}).listen(3000, () => console.log('dev server on :3000'))
`,
    },
  },
  'index.html': {
    file: {
      contents: `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>App</title></head>
  <body style="font-family: system-ui; max-width: 640px; margin: 4rem auto; padding: 0 1rem">
    <h1>Your app starts here</h1>
    <p>Ask the agent to build something — it edits these files in a real shell, in your browser tab. Then hit <b>Refresh preview</b>.</p>
  </body>
</html>
`,
    },
  },
}
