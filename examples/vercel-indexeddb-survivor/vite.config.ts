import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite frontend; `api/` is served by Vercel Functions in production.
// For local dev, run `vercel dev` so /api/agent is available alongside Vite.
export default defineConfig({
  plugins: [react()],
})
