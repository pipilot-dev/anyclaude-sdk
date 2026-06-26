#!/usr/bin/env node
// create-anyclaude-app — scaffold an anyclaude-sdk app from a template.
//
//   npm create anyclaude-app@latest my-app                 # default: bolt template
//   npm create anyclaude-app@latest my-app -- --template bolt
//
// Templates live in ./templates/<name>. The bolt template is an in-browser AI
// IDE (WebContainer + anyclaude-sdk + anyclaude-react): chat builds the app,
// real files + shell run in the tab, live preview via useWebContainerPreview.
import { cp, mkdir, readdir, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = join(HERE, 'templates')

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--template' || a === '-t') args.template = argv[++i]
    else if (a.startsWith('--template=')) args.template = a.slice('--template='.length)
    else if (!a.startsWith('-')) args._.push(a)
  }
  return args
}

async function listTemplates() {
  try {
    const entries = await readdir(TEMPLATES_DIR, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const templates = await listTemplates()
  const template = args.template || 'bolt'
  const targetName = args._[0]

  if (!targetName) {
    console.error('Usage: npm create anyclaude-app@latest <app-name> [-- --template <name>]')
    console.error(`Templates: ${templates.join(', ') || '(none found)'}`)
    process.exit(1)
  }
  if (!templates.includes(template)) {
    console.error(`Unknown template "${template}". Available: ${templates.join(', ')}`)
    process.exit(1)
  }

  const dest = resolve(process.cwd(), targetName)
  if (existsSync(dest)) {
    console.error(`Refusing to overwrite existing path: ${dest}`)
    process.exit(1)
  }

  const src = join(TEMPLATES_DIR, template)
  await mkdir(dest, { recursive: true })
  await cp(src, dest, { recursive: true })

  // npm renames .gitignore on publish — restore from _gitignore if present.
  const gi = join(dest, '_gitignore')
  if (existsSync(gi)) {
    await cp(gi, join(dest, '.gitignore'))
    await rm(gi)
  }

  // Stamp the project name into package.json.
  const pkgPath = join(dest, 'package.json')
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
    pkg.name = targetName.replace(/[^a-z0-9-]/gi, '-').toLowerCase()
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  }

  console.log(`\n  Created ${targetName} (template: ${template})\n`)
  console.log('  Next steps:')
  console.log(`    cd ${targetName}`)
  console.log('    npm install')
  console.log('    npm run dev\n')
  console.log('  The bolt template runs the agent in the browser against any')
  console.log('  CORS-enabled OpenAI/Anthropic-compatible endpoint — set it in the UI.\n')
}

// silence the unused import in environments where stat tree-shakes
void stat
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
