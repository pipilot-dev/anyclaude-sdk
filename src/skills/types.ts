// Skill types for browser-claude-sdk. A skill is a markdown document with
// optional frontmatter; it becomes an invokable slash command and is reachable
// via the `skill` tool.

export type Skill = {
  /** Skill name (used as the slash-command name and tool lookup key). */
  name: string
  /** One-line description of what the skill does. */
  description: string
  /** The skill body — instructions/prompt template ($ARGUMENTS is substituted). */
  body: string
  /** Optional hint for the skill's arguments (e.g. "<file>"). */
  argumentHint?: string
}
