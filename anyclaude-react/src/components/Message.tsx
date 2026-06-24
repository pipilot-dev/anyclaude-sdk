import { type ReactNode } from 'react'
import { Streamdown } from 'streamdown'

export interface MessageProps {
  role: 'user' | 'assistant'
  children?: ReactNode
  className?: string
}

/** A plain chat bubble. */
export function Message({ role, children, className }: MessageProps) {
  return (
    <div className={`ac-msg ac-msg-${role}${className ? ' ' + className : ''}`} data-role={role}>
      {role === 'user' && <span className="ac-msg-prefix" aria-hidden>›</span>}
      <div className="ac-msg-body">{children}</div>
    </div>
  )
}

export interface MarkdownMessageProps {
  text: string
  role?: 'user' | 'assistant'
  className?: string
  /** Override the markdown renderer (default: streamdown, streaming-aware). */
  render?: (text: string) => ReactNode
}

/** An assistant bubble whose text is rendered as markdown via streamdown. */
export function MarkdownMessage({ text, role = 'assistant', className, render }: MarkdownMessageProps) {
  return (
    <Message role={role} className={`ac-msg-md${className ? ' ' + className : ''}`}>
      {render ? render(text) : <Streamdown>{text}</Streamdown>}
    </Message>
  )
}
