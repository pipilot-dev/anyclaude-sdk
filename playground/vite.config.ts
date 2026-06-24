import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import fs from 'node:fs'

const sdkRoot = path.resolve(__dirname, '..')

// The SDK source uses NodeNext-style `./foo.js` import specifiers that point at
// `.ts` files. Vite/esbuild won't remap those by default, so rewrite relative
// `.js` imports to `.ts` when a sibling .ts exists. This lets us alias the SDK
// straight to its source (no separate build step).
function resolveTsFromJs(): Plugin {
  return {
    name: 'resolve-ts-from-js',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer) return null
      if (!source.endsWith('.js')) return null
      if (!source.startsWith('./') && !source.startsWith('../')) return null
      const tsPath = path.resolve(path.dirname(importer), source.slice(0, -3) + '.ts')
      if (fs.existsSync(tsPath)) return tsPath
      return null
    },
  }
}

// The SDK barrel re-exports modules that lazily `import('node:fs/promises')`
// (LocalSandbox) — never executed in the browser. Stub `node:` specifiers so
// the bundler doesn't fail resolving them.
function stubNodeBuiltins(): Plugin {
  const PREFIX = '\0node-stub:'
  return {
    name: 'stub-node-builtins',
    enforce: 'pre',
    resolveId(source) {
      if (source.startsWith('node:')) return PREFIX + source
      return null
    },
    load(id) {
      if (id.startsWith(PREFIX)) return 'export default {};'
      return null
    },
  }
}

const coiHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  plugins: [resolveTsFromJs(), stubNodeBuiltins(), react()],
  resolve: {
    alias: {
      '@browser-claude-sdk/core': path.resolve(sdkRoot, 'src/index.ts'),
    },
  },
  server: {
    headers: coiHeaders,
    fs: { allow: [sdkRoot] },
  },
  preview: { headers: coiHeaders },
  optimizeDeps: { exclude: ['@webcontainer/api'] },
})
