import { Fragment, type ReactNode } from 'react'
import type { SDKMessage } from 'anyclaude-sdk'
import { Message, MarkdownMessage } from './Message.js'
import { ToolCall, type ToolResultLike } from './ToolCall.js'

export interface TranscriptProps {
  messages: SDKMessage[]
  /** Live streaming text for the in-flight assistant turn (optional). */
  streamingText?: string
  className?: string
  /** Override markdown rendering. */
  renderMarkdown?: (text: string) => ReactNode
}

type Block = { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown>; tool_use_id?: string; content?: unknown; is_error?: boolean }

/** Renders an SDKMessage[] as chat bubbles + collapsible tool calls. */
export function Transcript({ messages, streamingText, className, renderMarkdown }: TranscriptProps) {
  // Pair tool_use blocks with their results (from synthetic user messages).
  const results = new Map<string, ToolResultLike>()
  for (const m of messages) {
    if (m.type === 'user') {
      const c = (m as { message: { content: unknown } }).message.content
      if (Array.isArray(c)) {
        for (const b of c as Block[]) {
          if (b.type === 'tool_result' && b.tool_use_id) results.set(b.tool_use_id, { content: b.content, isError: b.is_error })
        }
      }
    }
  }

  const rendered: ReactNode[] = []
  let k = 0
  for (const m of messages) {
    if (m.type === 'user') {
      const c = (m as { message: { content: unknown } }).message.content
      if (typeof c === 'string') {
        if (c.trim()) rendered.push(<Message key={k++} role="user">{c}</Message>)
      }
      // array content = tool results → shown via paired ToolCall, skip here
      continue
    }
    if (m.type === 'assistant') {
      const blocks = ((m as { message: { content: Block[] } }).message.content ?? []) as Block[]
      for (const b of blocks) {
        if (b.type === 'text' && b.text && b.text.trim()) {
          rendered.push(<MarkdownMessage key={k++} text={b.text} render={renderMarkdown} />)
        } else if (b.type === 'tool_use' && b.id) {
          rendered.push(<ToolCall key={k++} name={b.name ?? 'tool'} input={b.input} result={results.get(b.id)} />)
        }
      }
      continue
    }
    if (m.type === 'system') {
      const sub = (m as { subtype?: string }).subtype
      if (sub === 'local_command_output') {
        const text = (m as { content?: string }).content ?? ''
        if (text.trim()) rendered.push(<MarkdownMessage key={k++} text={text} render={renderMarkdown} />)
      }
      continue
    }
  }

  if (streamingText && streamingText.trim()) {
    rendered.push(<MarkdownMessage key="streaming" text={streamingText} render={renderMarkdown} />)
  }

  return <div className={`ac-transcript${className ? ' ' + className : ''}`}><Fragment>{rendered}</Fragment></div>
}
