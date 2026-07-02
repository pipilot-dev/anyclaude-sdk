#!/usr/bin/env node
// Single source of truth for the version: package.json. This regenerates
// src/version.ts from package.json's `version` so the code's SDK_VERSION can
// never drift from the published package (that drift shipped a wrong internal
// version in 0.14.2/0.14.3). Runs automatically on `prebuild` (hence before
// `build` and `prepublishOnly`). Bump ONLY package.json.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const target = join(root, 'src', 'version.ts')

const content =
  `// AUTO-GENERATED from package.json by scripts/sync-version.mjs (runs on prebuild).\n` +
  `// Do NOT edit the version here — bump \`version\` in package.json instead.\n` +
  `export const SDK_VERSION = '${pkg.version}'\n`

const current = (() => {
  try {
    return readFileSync(target, 'utf8')
  } catch {
    return ''
  }
})()

if (current !== content) {
  writeFileSync(target, content)
  console.log(`sync-version: src/version.ts → SDK_VERSION = '${pkg.version}'`)
} else {
  console.log(`sync-version: already at '${pkg.version}'`)
}
