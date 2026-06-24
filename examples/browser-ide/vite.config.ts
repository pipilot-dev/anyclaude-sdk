import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// WebContainer needs cross-origin isolation (SharedArrayBuffer) → these headers.
const coi = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}
export default defineConfig({
  // Relative base so the build works when served from a subpath (e.g. /demo/).
  base: './',
  plugins: [react()],
  server: { headers: coi },
  preview: { headers: coi },
  optimizeDeps: { exclude: ['@webcontainer/api'] },
})
