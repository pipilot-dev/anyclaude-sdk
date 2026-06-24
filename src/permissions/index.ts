// Permission rule-matching system: allow/deny/ask rules, dangerous-command
// detection, and plan-mode tool classification.

export type {
  PermissionBehavior,
  PermissionRule,
  PermissionRuleSet,
  PermissionUpdateInput,
} from './types.js'
export {
  canonical,
  parseRule,
  ruleContentForInput,
  matchContent,
  matchRule,
  evaluate,
  ruleSetFromStrings,
} from './match.js'
export { isDangerousBash } from './dangerous.js'
export { READ_ONLY_TOOLS, isReadOnlyTool } from './planMode.js'
export { rulesToCanUseTool, applyPermissionUpdate, type GateOptions } from './gate.js'
