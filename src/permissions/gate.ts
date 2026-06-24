// Turn a rule set into a CanUseTool gate, and apply permission updates.

import type { CanUseTool, PermissionMode } from '../types/index.js'
import type { PermissionRuleSet, PermissionUpdateInput } from './types.js'
import { canonical, evaluate } from './match.js'
import { isDangerousBash } from './dangerous.js'
import { isReadOnlyTool } from './planMode.js'

export interface GateOptions {
  /** Permission mode; 'bypassPermissions' allows all, 'plan' denies non-read-only tools. */
  mode?: PermissionMode
  /** Interactive prompt for 'ask'/unmatched calls. true → allow, false → deny. */
  onAsk?: (toolName: string, input: Record<string, unknown>) => Promise<boolean>
  /** Block obviously-destructive bash unless an explicit allow rule matched. Default true. */
  flagDangerous?: boolean
}

/**
 * Build a CanUseTool from a rule set.
 *
 * Resolution order: bypass → plan-mode read-only check → deny rule → allow rule
 * → dangerous-bash backstop → ask (onAsk / mode). With no UI and mode 'default'
 * an unmatched call is ALLOWED (documented); use 'dontAsk' to deny-by-default,
 * or provide `onAsk`.
 */
export function rulesToCanUseTool(
  ruleset: PermissionRuleSet,
  opts: GateOptions = {}
): CanUseTool {
  const flagDangerous = opts.flagDangerous !== false
  return async (toolName, input) => {
    const behavior = evaluate(ruleset, toolName, input)

    // Explicit deny is a hard block — it wins even in bypassPermissions mode.
    if (behavior === 'deny') {
      return { behavior: 'deny', message: `Denied by permission rule for "${toolName}".` }
    }

    if (opts.mode === 'bypassPermissions') return { behavior: 'allow' }

    // Plan mode: only read-only tools may run.
    if (opts.mode === 'plan' && !isReadOnlyTool(toolName, input)) {
      return { behavior: 'deny', message: `Plan mode: "${toolName}" is not a read-only tool; planning only.` }
    }

    if (behavior === 'allow') return { behavior: 'allow' }

    // Dangerous-bash backstop (only when not explicitly allowed above).
    if (flagDangerous && canonical(toolName) === 'bash') {
      const d = isDangerousBash(String(input.command ?? ''))
      if (d.dangerous) {
        return { behavior: 'deny', message: `Blocked potentially destructive command (${d.reason}). Add an allow rule to override.` }
      }
    }

    // 'ask' rule or no match.
    if (opts.onAsk) {
      const ok = await opts.onAsk(toolName, input)
      return ok ? { behavior: 'allow' } : { behavior: 'deny', message: 'Denied by user.' }
    }
    if (opts.mode === 'dontAsk') {
      return { behavior: 'deny', message: `No matching allow rule for "${toolName}" (dontAsk mode).` }
    }
    return { behavior: 'allow' } // default: no UI available → allow
  }
}

/** Apply a permission update to a rule set (pure; setMode is a no-op on rules). */
export function applyPermissionUpdate(
  ruleset: PermissionRuleSet,
  update: PermissionUpdateInput
): PermissionRuleSet {
  const next: PermissionRuleSet = {
    allow: [...ruleset.allow],
    deny: [...ruleset.deny],
    ask: [...ruleset.ask],
  }
  const beh = update.behavior
  const rules = update.rules ?? []
  if (!beh) return next
  if (update.type === 'addRules') next[beh] = [...next[beh], ...rules]
  else if (update.type === 'replaceRules') next[beh] = [...rules]
  else if (update.type === 'removeRules') {
    next[beh] = next[beh].filter(
      (r) => !rules.some((x) => x.toolName === r.toolName && x.ruleContent === r.ruleContent)
    )
  }
  return next
}
