// Conservative detection of obviously-destructive shell commands. Used as a
// last-resort backstop when no explicit allow rule matched.

const PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\brm\s+(-[a-z]*\s+)*-?[rf][rf]?\s+(\/|~|\/\*|\$HOME|\.\s*$|\*\s*$)/i, reason: 'recursive force-delete of a top-level/home path' },
  { re: /\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/i, reason: 'rm -rf' },
  { re: /\bmkfs(\.\w+)?\b/i, reason: 'filesystem format (mkfs)' },
  { re: /\bdd\b[^\n]*\bof=\/dev\/[sh]d/i, reason: 'dd write to a raw disk device' },
  { re: />\s*\/dev\/[sh]d[a-z]/i, reason: 'redirect to a raw disk device' },
  { re: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, reason: 'fork bomb' },
  { re: /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/i, reason: 'pipe remote script straight into a shell' },
  { re: /\bchmod\s+-R\s+777\s+\//i, reason: 'recursive chmod 777 on root' },
  { re: /\bgit\s+push\b[^\n]*--force[^\n]*\b(origin\s+)?(main|master)\b/i, reason: 'force-push to main/master' },
  { re: /\bgit\s+push\b[^\n]*\b(main|master)\b[^\n]*--force/i, reason: 'force-push to main/master' },
  { re: /\b(shutdown|reboot|halt|poweroff)\b/i, reason: 'system power command' },
  { re: /\bsudo\s+rm\b/i, reason: 'sudo rm' },
]

export function isDangerousBash(command: string): { dangerous: boolean; reason?: string } {
  const cmd = (command || '').trim()
  for (const { re, reason } of PATTERNS) {
    if (re.test(cmd)) return { dangerous: true, reason }
  }
  return { dangerous: false }
}
