// Slash-command entry point. The agent loop calls runSlashCommand() when a user
// message is a string beginning with '/'. Returns null when the text isn't a
// recognized command (the loop then treats it as a normal prompt).

import { BUILTIN_COMMANDS } from './builtins.js'
import type { SlashCommand, SlashCommandContext, SlashOutcome } from './types.js'

export * from './types.js'
export { BUILTIN_COMMANDS } from './builtins.js'

/** Parse `/name args...` → { name (lowercased, no slash), args }. Null if not a command. */
export function parseSlashCommand(text: string): { name: string; args: string } | null {
  const t = text.trimStart()
  if (!t.startsWith('/')) return null
  const body = t.slice(1)
  const sp = body.search(/\s/)
  if (sp === -1) return { name: body.toLowerCase(), args: '' }
  return { name: body.slice(0, sp).toLowerCase(), args: body.slice(sp + 1).trim() }
}

/**
 * Resolve and execute a slash command. Returns the command's SlashOutcome, or
 * null when the text isn't a slash command or names an unknown command (so the
 * caller can fall back to treating it as a normal prompt).
 */
export async function runSlashCommand(
  text: string,
  ctx: Omit<SlashCommandContext, 'commands'> & { commands?: SlashCommand[] }
): Promise<SlashOutcome | null> {
  const parsed = parseSlashCommand(text)
  if (!parsed) return null

  // User commands override built-ins by name.
  const merged = mergeCommands(BUILTIN_COMMANDS, ctx.commands ?? [])
  const command = merged.find((c) => c.name === parsed.name)
  if (!command) return null

  const fullCtx: SlashCommandContext = { ...ctx, commands: merged }
  return await command.run(parsed.args, fullCtx)
}

function mergeCommands(builtins: SlashCommand[], user: SlashCommand[]): SlashCommand[] {
  const byName = new Map<string, SlashCommand>()
  for (const c of builtins) byName.set(c.name, c)
  for (const c of user) byName.set(c.name, c) // user overrides
  return [...byName.values()]
}

/**
 * Define a custom prompt-template command (like a Claude Code markdown command).
 * `$ARGUMENTS` in the template is replaced with the invocation args.
 */
export function promptCommand(
  name: string,
  description: string,
  prompt: string,
  argumentHint?: string
): SlashCommand {
  return {
    name,
    description,
    argumentHint,
    run(args): SlashOutcome {
      return { expandedPrompt: prompt.replace(/\$ARGUMENTS/g, args) }
    },
  }
}
