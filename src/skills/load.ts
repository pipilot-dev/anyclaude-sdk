// Discover and load skills from a FileSystem, and turn them into slash commands.

import type { SlashCommand, SlashOutcome } from '../commands/types.js'
import type { Skill } from './types.js'
import { parseSkill } from './parse.js'

interface SkillFs {
  readFile(path: string): Promise<string | null>
  readdir(path: string): Promise<Array<{ name: string; isDir: boolean }> | null>
}

/** Substitute $ARGUMENTS in a skill body with the invocation args. */
export function applySkillArgs(body: string, args: string): string {
  return body.includes('$ARGUMENTS') ? body.split('$ARGUMENTS').join(args) : body
}

/**
 * Load skills from `<dir>`. Supports both flat `<dir>/<name>.md` files and
 * nested `<dir>/<name>/SKILL.md`. Never throws — returns [] on any failure.
 */
export async function loadSkillsFromFs(fs: SkillFs, dir = '.claude/skills'): Promise<Skill[]> {
  const entries = await fs.readdir(dir).catch(() => null)
  if (!entries) return []
  const skills: Skill[] = []

  for (const entry of entries) {
    try {
      if (entry.isDir) {
        // Nested form: <dir>/<name>/SKILL.md (or skill.md).
        for (const file of ['SKILL.md', 'skill.md']) {
          const md = await fs.readFile(`${dir}/${entry.name}/${file}`)
          if (md != null) {
            skills.push(parseSkill(md, entry.name))
            break
          }
        }
      } else if (entry.name.toLowerCase().endsWith('.md')) {
        const md = await fs.readFile(`${dir}/${entry.name}`)
        if (md != null) skills.push(parseSkill(md, entry.name.replace(/\.md$/i, '')))
      }
    } catch {
      // skip unreadable entries
    }
  }
  return skills
}

/**
 * Turn skills into slash commands. Invoking `/skillName args` expands the
 * skill body (with $ARGUMENTS substituted) into a prompt. Built inline to avoid
 * a dependency cycle with the commands module.
 */
export function skillsToCommands(skills: Skill[]): SlashCommand[] {
  return skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    argumentHint: skill.argumentHint,
    run(args: string): SlashOutcome {
      return { expandedPrompt: applySkillArgs(skill.body, args.trim()) }
    },
  }))
}
