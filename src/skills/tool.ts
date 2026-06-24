// The `skill` tool: load a named skill's instructions so the model can follow
// them. Skills are made available on the tool context as `ctx.skills`.

import type { Tool } from '../tools/types.js'
import type { Skill } from './types.js'
import { applySkillArgs } from './load.js'

const DESCRIPTION = `Loads a named skill's instructions and returns them so you can follow the skill.

Use this when a task matches an available skill. Pass the skill \`name\` and optional \`arguments\`; the skill's full instructions are returned as the result.`

export const skill: Tool = {
  def: {
    type: 'function',
    function: {
      name: 'skill',
      description: DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The skill name to invoke.' },
          arguments: { type: 'string', description: 'Arguments to pass to the skill (substituted for $ARGUMENTS).' },
        },
        required: ['name'],
      },
    },
  },
  async run(input, ctx) {
    const skills = (ctx as { skills?: Skill[] }).skills
    if (!skills || !skills.length) {
      return { content: 'No skills are available in this session.', isError: true }
    }
    const name = String(input.name ?? '').trim()
    const found = skills.find((s) => s.name === name) ?? skills.find((s) => s.name.toLowerCase() === name.toLowerCase())
    if (!found) {
      return {
        content: `Unknown skill "${name}". Available: ${skills.map((s) => s.name).join(', ')}`,
        isError: true,
      }
    }
    const args = input.arguments != null ? String(input.arguments) : ''
    return { content: `# Skill: ${found.name}\n\n${applySkillArgs(found.body, args)}` }
  },
}
