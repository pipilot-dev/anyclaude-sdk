// Skills system: load .claude/skills/*.md markdown skills and expose them as
// slash commands and via the `skill` tool.

export type { Skill } from './types.js'
export { parseSkill } from './parse.js'
export { loadSkillsFromFs, skillsToCommands, applySkillArgs } from './load.js'
export { skill } from './tool.js'
export { defineSkill, type DefineSkillSpec } from './define.js'
