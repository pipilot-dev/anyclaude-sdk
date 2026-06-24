// Built-in slash commands: /help, /clear, /compact, /tools, /cost, /model.

import type { ChatMsg } from '../types/index.js'
import type { SlashCommand, SlashCommandContext, SlashOutcome } from './types.js'

/** Render the conversation (minus the system message) as a plain transcript. */
function transcript(history: ChatMsg[]): string {
  return history
    .slice(1)
    .map((m) => {
      const body =
        typeof m.content === 'string'
          ? m.content
          : m.content
              .map((b) =>
                b.type === 'text'
                  ? b.text
                  : b.type === 'tool_use'
                    ? `[tool_use ${b.name} ${JSON.stringify(b.input)}]`
                    : b.type === 'tool_result'
                      ? `[tool_result ${typeof b.content === 'string' ? b.content : '...'}]`
                      : `[${b.type}]`
              )
              .join('\n')
      const calls = m.tool_calls?.length
        ? ' ' + m.tool_calls.map((c) => `[call ${c.function.name}(${c.function.arguments})]`).join(' ')
        : ''
      return `${m.role.toUpperCase()}: ${body}${calls}`
    })
    .join('\n\n')
}

const help: SlashCommand = {
  name: 'help',
  description: 'List available slash commands',
  run(_args, ctx): SlashOutcome {
    const lines = ctx.commands
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => `  /${c.name}${c.argumentHint ? ' ' + c.argumentHint : ''} — ${c.description}`)
    return { systemText: `Available commands:\n${lines.join('\n')}` }
  },
}

const clear: SlashCommand = {
  name: 'clear',
  description: 'Clear the conversation history (keeps the system prompt)',
  run(_args, ctx): SlashOutcome {
    return {
      newHistory: ctx.history.length ? [ctx.history[0]] : [],
      systemText: 'Conversation cleared.',
    }
  },
}

const compact: SlashCommand = {
  name: 'compact',
  description: 'Summarize the conversation so far to free up context',
  argumentHint: '[focus instructions]',
  async run(args, ctx): Promise<SlashOutcome> {
    if (!ctx.llm) {
      return { systemText: 'Compaction requires an LLM client, which is not available here.' }
    }
    if (ctx.history.length <= 1) {
      return { systemText: 'Nothing to compact yet.' }
    }
    const focus = args.trim()
    const instruction =
      'Summarize the following conversation transcript concisely but completely. ' +
      'Preserve: the user’s goals, key decisions, files created/edited (with paths), ' +
      'important findings, and any unfinished work or next steps. Use short sections.' +
      (focus ? `\nPay special attention to: ${focus}` : '')

    const messages: ChatMsg[] = [
      { role: 'system', content: 'You are a precise conversation summarizer.' },
      { role: 'user', content: `${instruction}\n\n---\n${transcript(ctx.history)}` },
    ]
    let summary = ''
    try {
      const res = await ctx.llm.streamChat(messages, {
        model: ctx.model,
        signal: ctx.signal,
        onToken: () => {},
      })
      summary = res.text?.trim() ?? ''
    } catch (err) {
      return {
        systemText: `Compaction failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
    if (!summary) return { systemText: 'Compaction produced no summary; history left unchanged.' }

    const newHistory: ChatMsg[] = [
      ctx.history[0],
      { role: 'user', content: `Summary of the conversation so far:\n${summary}` },
    ]
    return {
      newHistory,
      compacted: true,
      systemText: 'Conversation compacted into a summary.',
    }
  },
}

const tools: SlashCommand = {
  name: 'tools',
  description: 'List the tools available to the agent',
  run(_args, ctx): SlashOutcome {
    if (!ctx.tools.length) return { systemText: 'No tools available.' }
    const lines = ctx.tools.map((t) => `  ${t.name} — ${t.description.split('\n')[0]}`)
    return { systemText: `Available tools (${ctx.tools.length}):\n${lines.join('\n')}` }
  },
}

const cost: SlashCommand = {
  name: 'cost',
  description: 'Show token usage for this session',
  run(_args, ctx): SlashOutcome {
    if (!ctx.usage) return { systemText: 'No usage recorded yet.' }
    const u = ctx.usage
    return {
      systemText: `Token usage — input: ${u.input_tokens}, output: ${u.output_tokens}${
        u.cache_read_input_tokens ? `, cache read: ${u.cache_read_input_tokens}` : ''
      }`,
    }
  },
}

const model: SlashCommand = {
  name: 'model',
  description: 'Show the active model',
  run(_args, ctx): SlashOutcome {
    return { systemText: `Model: ${ctx.model ?? 'unknown'}` }
  },
}

const sessions: SlashCommand = {
  name: 'sessions',
  description: 'List saved sessions',
  async run(_args, ctx): Promise<SlashOutcome> {
    if (!ctx.sessionStore) return { systemText: 'No session store configured.' }
    const list = await ctx.sessionStore.list()
    if (!list.length) return { systemText: 'No saved sessions.' }
    const lines = list.map(
      (s) => `  ${s.sessionId}${s.sessionId === ctx.sessionId ? ' (current)' : ''} — ${s.title ?? '(untitled)'} · ${s.messageCount} msgs`
    )
    return { systemText: `Saved sessions:\n${lines.join('\n')}\n\nResume with: /resume <id>` }
  },
}

const resume: SlashCommand = {
  name: 'resume',
  description: 'Resume a saved session by id',
  argumentHint: '<session-id>',
  async run(args, ctx): Promise<SlashOutcome> {
    if (!ctx.sessionStore) return { systemText: 'No session store configured.' }
    const id = args.trim()
    if (!id) return { systemText: 'Usage: /resume <session-id>  (see /sessions)' }
    const prior = await ctx.sessionStore.load(id)
    if (!prior || !prior.length) return { systemText: `No transcript found for session "${id}".` }
    return { newHistory: prior, systemText: `Resumed session ${id} (${prior.length - 1} prior messages).` }
  },
}

const rename: SlashCommand = {
  name: 'rename',
  description: 'Rename the current session',
  argumentHint: '<title>',
  async run(args, ctx): Promise<SlashOutcome> {
    if (!ctx.sessionStore || !ctx.sessionId) return { systemText: 'No active session to rename.' }
    const title = args.trim()
    if (!title) return { systemText: 'Usage: /rename <title>' }
    await ctx.sessionStore.rename(ctx.sessionId, title)
    return { systemText: `Session renamed to "${title}".` }
  },
}

const diff: SlashCommand = {
  name: 'diff',
  description: 'Show uncommitted git changes',
  async run(_args, ctx): Promise<SlashOutcome> {
    if (!ctx.exec) return { systemText: 'No shell available for /diff.' }
    const { output, exitCode } = await ctx.exec('git diff --stat && echo "---" && git diff')
    if (exitCode !== 0 && !output.trim()) return { systemText: 'No changes, or not a git repository.' }
    return { systemText: '```diff\n' + (output.trim() || '(no changes)').slice(0, 8000) + '\n```' }
  },
}

const tasks: SlashCommand = {
  name: 'tasks',
  description: 'List background tasks',
  run(_args, ctx): SlashOutcome {
    if (!ctx.background) return { systemText: 'Background tasks are not enabled.' }
    const list = ctx.background.list()
    if (!list.length) return { systemText: 'No background tasks.' }
    return { systemText: 'Background tasks:\n' + list.map((t) => `  ${t.id} [${t.status}] ${t.description}`).join('\n') }
  },
}

const board: SlashCommand = {
  name: 'board',
  description: 'List the team task board',
  run(_args, ctx): SlashOutcome {
    if (!ctx.board) return { systemText: 'Teammates are not enabled.' }
    const list = ctx.board.list()
    if (!list.length) return { systemText: 'Task board is empty.' }
    return { systemText: 'Task board:\n' + list.map((t) => `  ${t.id} [${t.status}]${t.owner ? ' @' + t.owner : ''} — ${t.subject}`).join('\n') }
  },
}

const context: SlashCommand = {
  name: 'context',
  description: 'Show approximate context usage',
  run(_args, ctx): SlashOutcome {
    let chars = 0
    for (const m of ctx.history) {
      chars += typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length
    }
    const approxTokens = Math.round(chars / 4)
    return {
      systemText: `Context: ${ctx.history.length} messages, ~${approxTokens.toLocaleString()} tokens (${chars.toLocaleString()} chars).`,
    }
  },
}

const files: SlashCommand = {
  name: 'files',
  description: 'List files read this session',
  run(_args, ctx): SlashOutcome {
    const fs = ctx.readFiles ? [...ctx.readFiles] : []
    if (!fs.length) return { systemText: 'No files read yet this session.' }
    return { systemText: `Files read (${fs.length}):\n${fs.map((f) => '  ' + f).join('\n')}` }
  },
}

const agents: SlashCommand = {
  name: 'agents',
  description: 'List configured sub-agents',
  run(_args, ctx): SlashOutcome {
    const a = ctx.agents ? Object.entries(ctx.agents) : []
    if (!a.length) return { systemText: 'No custom agents configured.' }
    return { systemText: 'Agents:\n' + a.map(([n, d]) => `  ${n}${d.model ? ' (' + d.model + ')' : ''} — ${d.description}`).join('\n') }
  },
}

const mcp: SlashCommand = {
  name: 'mcp',
  description: 'Show MCP server status',
  run(_args, ctx): SlashOutcome {
    const s = ctx.mcpServers ?? []
    if (!s.length) return { systemText: 'No MCP servers configured.' }
    return { systemText: 'MCP servers:\n' + s.map((x) => `  ${x.name} — ${x.status}`).join('\n') }
  },
}

const permissions: SlashCommand = {
  name: 'permissions',
  description: 'Show the active permission mode',
  run(_args, ctx): SlashOutcome {
    return { systemText: `Permission mode: ${ctx.permissionMode ?? 'default'}` }
  },
}

const memory: SlashCommand = {
  name: 'memory',
  description: 'Show persistent memory (store + CLAUDE.md / MEMORY.md)',
  async run(_args, ctx): Promise<SlashOutcome> {
    const parts: string[] = []
    if (ctx.memory) {
      const rendered = await ctx.memory.render()
      if (rendered) parts.push(rendered)
    }
    if (ctx.fs) {
      for (const name of ['CLAUDE.md', 'MEMORY.md', '.claude/CLAUDE.md']) {
        const c = await ctx.fs.readFile(name)
        if (c) {
          parts.push(`# ${name}\n\n${c.slice(0, 4000)}`)
          break
        }
      }
    }
    return { systemText: parts.length ? parts.join('\n\n---\n\n') : 'No memory or CLAUDE.md/MEMORY.md found.' }
  },
}

const exportCmd: SlashCommand = {
  name: 'export',
  description: 'Export the conversation transcript (markdown)',
  run(_args, ctx): SlashOutcome {
    return { systemText: '```markdown\n' + transcript(ctx.history) + '\n```' }
  },
}

const review: SlashCommand = {
  name: 'review',
  description: 'Ask the agent to review recent changes',
  argumentHint: '[path or focus]',
  run(args): SlashOutcome {
    return {
      expandedPrompt:
        `Review the code changes${args.trim() ? ' in/related to ' + args.trim() : ''} for bugs, security issues, and quality. ` +
        'Use git diff and read the relevant files, then give a prioritized list of findings.',
    }
  },
}

const init: SlashCommand = {
  name: 'init',
  description: 'Analyze the project and write a CLAUDE.md',
  run(): SlashOutcome {
    return {
      expandedPrompt:
        'Analyze this project (structure, key files, build/test commands, conventions) and write a concise CLAUDE.md ' +
        'at the project root capturing what a coding agent needs to know. Use list_files/read_file/grep to investigate first.',
    }
  },
}

export const BUILTIN_COMMANDS: SlashCommand[] = [
  help, clear, compact, tools, cost, model,
  sessions, resume, rename, diff, tasks, board, context, files, agents, mcp,
  permissions, memory, exportCmd, review, init,
]
