import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// WebContainer requires cross-origin isolation (COOP/COEP). These headers
// enable it in dev; set the same on your production host (or use coi-serviceworker
// on static hosts that can't send headers).
export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    exclude: ['@webcontainer/api'],
  },
})
