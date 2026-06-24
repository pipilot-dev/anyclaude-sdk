import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// WebContainer needs cross-origin isolation (SharedArrayBuffer) → these headers.
const coi = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}
export default defineConfig({
  plugins: [react()],
  // `vercel dev` serves the frontend + api/ together. Standalone `vite` proxies /api.
  server: { headers: coi, proxy: { '/api': 'http://localhost:3000' } },
  preview: { headers: coi },
  optimizeDeps: { exclude: ['@webcontainer/api'] },
})
