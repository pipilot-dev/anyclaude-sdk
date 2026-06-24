import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Frontend only. For full local dev (including the /api function), run `vercel dev`.
export default defineConfig({ plugins: [react()] })
