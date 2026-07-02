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
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vite + React Starter</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  </head>
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
import './index.css'

createRoot(document.getElementById('root')).render(<App />)
`,
        },
      },
      'index.css': {
        file: {
          contents: `:root {
  font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
  line-height: 1.5;
  font-weight: 400;
  color-scheme: dark;
  color: #e2e8f0;
  background-color: #0b0f17;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  margin: 0;
  display: flex;
  place-items: center;
  min-width: 320px;
  min-height: 100vh;
}

#root {
  max-width: 1280px;
  margin: 0 auto;
  padding: 2rem;
  text-align: center;
  width: 100%;
}

a {
  font-weight: 500;
  color: #6366f1;
  text-decoration: inherit;
  transition: color 0.25s;
}
a:hover {
  color: #818cf8;
}

h1 {
  font-size: 3em;
  line-height: 1.1;
  margin-bottom: 0.2em;
  font-weight: 700;
  letter-spacing: -0.02em;
  background: linear-gradient(135deg, #a5b4fc, #6366f1);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.card {
  padding: 2em;
  border-radius: 12px;
  background-color: #111827;
  border: 1px solid #1f2937;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  margin: 2rem auto;
  max-width: 500px;
}

button.counter-btn {
  border-radius: 8px;
  border: 1px solid transparent;
  padding: 0.6em 1.2em;
  font-size: 1em;
  font-weight: 600;
  font-family: inherit;
  background-color: #6366f1;
  color: white;
  cursor: pointer;
  transition: all 0.25s;
  box-shadow: 0 2px 10px rgba(99, 102, 241, 0.3);
}
button.counter-btn:hover {
  background-color: #4f46e5;
  transform: translateY(-1px);
}
button.counter-btn:active {
  transform: translateY(0);
}

.read-the-docs {
  color: #888;
  font-size: 0.9em;
  margin-top: 2rem;
}

.tech-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 1rem;
  max-width: 600px;
  margin: 3rem auto 0;
}

.tech-item {
  padding: 1rem;
  border-radius: 8px;
  background: #11182760;
  border: 1px solid #1f293780;
}
.tech-item h4 {
  margin: 0 0 0.25em 0;
  color: #fff;
}
.tech-item p {
  margin: 0;
  font-size: 0.8em;
  color: #64748b;
}
`,
        },
      },
      'App.jsx': {
        file: {
          contents: `import { useState } from 'react'

export default function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="container">
      <div className="logo-container" style={{ display: 'flex', justifyContent: 'center', gap: '1.5rem', marginBottom: '1rem' }}>
        <span style={{ fontSize: '3rem', filter: 'drop-shadow(0 0 2em #646cffaa)' }}>⚡</span>
        <span style={{ fontSize: '3rem', filter: 'drop-shadow(0 0 2em #61dafbaa)' }}>⚛️</span>
      </div>
      
      <h1>Vite + React Sandbox</h1>
      <p style={{ color: '#64748b', fontSize: '1.1em', maxWidth: '580px', margin: '0 auto 2rem' }}>
        Your sandboxed in-browser React workspace is successfully configured and hot-reloading!
      </p>

      <div className="card">
        <button className="counter-btn" onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <p style={{ marginTop: '1.5rem', fontSize: '0.9em', color: '#94a3b8' }}>
          Edit <code>src/App.jsx</code> and save to hot-reload this preview.
        </p>
      </div>

      <div className="tech-grid">
        <div className="tech-item">
          <h4>Vite</h4>
          <p>Super fast HMR dev server</p>
        </div>
        <div className="tech-item">
          <h4>React</h4>
          <p>Component-driven UI library</p>
        </div>
        <div className="tech-item">
          <h4>WebContainer</h4>
          <p>In-browser Node sandbox</p>
        </div>
        <div className="tech-item">
          <h4>pnpm</h4>
          <p>Fast, memory-efficient deps</p>
        </div>
      </div>

      <p className="read-the-docs">
        Ask the AI Builder Agent in the panel on the left to write code or add pages!
      </p>
    </div>
  )
}
`,
        },
      },
    },
  },
}

