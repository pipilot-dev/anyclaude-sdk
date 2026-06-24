// Permission rule types — allow/deny/ask rules matched against tool calls.

export type PermissionBehavior = 'allow' | 'deny' | 'ask'

/** A single rule: a tool name plus an optional content matcher (glob/prefix). */
export type PermissionRule = {
  toolName: string
  ruleContent?: string
}

/** Rules grouped by behavior. */
export type PermissionRuleSet = {
  allow: PermissionRule[]
  deny: PermissionRule[]
  ask: PermissionRule[]
}

/** A loose permission-update shape (mirrors the SDK's PermissionUpdate variants). */
export type PermissionUpdateInput = {
  type: 'addRules' | 'replaceRules' | 'removeRules' | 'setMode' | string
  rules?: PermissionRule[]
  behavior?: PermissionBehavior
  mode?: string
}
