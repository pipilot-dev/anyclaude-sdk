// Load + cascade settings from the workspace filesystem.

import type { Settings } from './types.js'
import { mergeSettings, parseSettings } from './merge.js'

type ReadableFs = { readFile(path: string): Promise<string | null> }

function join(cwd: string, rel: string): string {
  if (!cwd) return rel
  return cwd.endsWith('/') ? cwd + rel : cwd + '/' + rel
}

/**
 * Load and cascade settings from the workspace. Reads `.claude/settings.json`
 * (project) then `.claude/settings.local.json` (local) relative to `cwd`,
 * merging project < local. (No home dir in the browser, so user-scope is
 * omitted.) Never throws — missing/invalid files contribute {}.
 */
export async function loadSettings(
  fs: ReadableFs,
  opts: { cwd?: string } = {}
): Promise<Settings> {
  const cwd = opts.cwd ?? ''
  const read = async (rel: string): Promise<Settings> => {
    try {
      const txt = await fs.readFile(join(cwd, rel))
      return txt ? parseSettings(txt) : {}
    } catch {
      return {}
    }
  }
  const project = await read('.claude/settings.json')
  const local = await read('.claude/settings.local.json')
  return mergeSettings(project, local)
}

/** Extract raw permission-rule strings for the permissions module to parse. */
export function settingsToPermissionRuleSet(s: Settings): {
  allow: string[]
  deny: string[]
  ask: string[]
} {
  return {
    allow: s.allow ?? [],
    deny: s.deny ?? [],
    ask: s.ask ?? [],
  }
}
