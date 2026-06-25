// defineSkill — ergonomic, validated programmatic skill declaration (parallels
// defineTool). A skill becomes an invokable slash command and is reachable via
// the `skill` tool. Pass the result(s) to query({ skills: [...] }).
import type { Skill } from './types.js'

export interface DefineSkillSpec {
  /** Skill name — used as the slash-command name and the `skill` tool lookup key. */
  name: string
  /** One-line description of what the skill does (shown to the model + in /help). */
  description: string
  /** The skill's instructions / prompt template. `$ARGUMENTS` is substituted at call time. */
  instructions: string
  /** Optional argument hint, e.g. "<file>" or "<topic>". */
  argumentHint?: string
}

/**
 * Define a skill programmatically:
 *
 *   query({ skills: [defineSkill({
 *     name: 'changelog',
 *     description: 'Summarize git changes into a changelog entry',
 *     instructions: 'Write a concise changelog entry for: $ARGUMENTS',
 *   })] })
 *
 * It is registered as a `/changelog` slash command and is invokable by the agent
 * through the `skill` tool. (You can also pass plain `Skill` objects directly.)
 */
export function defineSkill(spec: DefineSkillSpec): Skill {
  const name = String(spec.name ?? '').trim()
  if (!name) throw new Error('defineSkill: `name` is required.')
  if (!/^[A-Za-z0-9][\w:-]*$/.test(name)) {
    throw new Error(`defineSkill: invalid name "${name}" (use letters, digits, _ - :).`)
  }
  const instructions = String(spec.instructions ?? '')
  if (!instructions.trim()) throw new Error(`defineSkill("${name}"): \`instructions\` is required.`)
  return {
    name,
    description: String(spec.description ?? '').trim(),
    body: instructions,
    ...(spec.argumentHint ? { argumentHint: String(spec.argumentHint) } : {}),
  }
}
