// The starter project mounted into the WebContainer — a real Vite + React app.
// The IDE runs `npm install` then `npm run dev`; the agent edits these files and
// Vite hot-reloads the preview. (For an instant, install-free preview, swap this
// for a zero-dependency Node static server and adjust the dev script.)
import type { FileSystemTree } from '@webcontainer/api'

export const starterFiles: FileSystemTree = {
  'package.json': {
    file: {
      contents: JSON.stringify(
        {
          name: 'app',
          private: true,
          type: 'module',
          scripts: { dev: 'vite --port 3000' },
          dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
          devDependencies: { '@vitejs/plugin-react': '^4.3.1', vite: '^5.4.0' },
        },
        null,
        2
      ),
    },
  },
  'vite.config.js': {
    file: {
      contents: `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({ plugins: [react()], server: { host: true } })
`,
    },
  },
  'index.html': {
    file: {
      contents: `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>App</title></head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`,
    },
  },
  src: {
    directory: {
      'main.jsx': {
        file: {
          contents: `import { createRoot } from 'react-dom/client'
import App from './App.jsx'
createRoot(document.getElementById('root')).render(<App />)
`,
        },
      },
      'App.jsx': {
        file: {
          contents: `export default function App() {
  return (
    <main style={{ fontFamily: 'system-ui', maxWidth: 640, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Your app starts here</h1>
      <p>Ask the agent to build something. It edits these files in a real shell, in your browser tab, and Vite hot-reloads this preview.</p>
    </main>
  )
}
`,
        },
      },
    },
  },
}
