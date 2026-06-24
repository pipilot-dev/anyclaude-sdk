import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `vercel dev` serves the frontend + the api/ functions together. If you instead
// run `vite` standalone alongside a function server, this proxy forwards /api.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:3000' } },
})
