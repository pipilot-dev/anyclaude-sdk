import { useState, type KeyboardEvent } from 'react'

export interface ComposerProps {
  onSend: (text: string) => void
  disabled?: boolean
  placeholder?: string
  className?: string
  /** Send on Enter (Shift+Enter = newline). Default true. */
  sendOnEnter?: boolean
}

/** Textarea + send button. Enter sends; Shift+Enter inserts a newline. */
export function Composer({ onSend, disabled, placeholder = 'Send a message…', className, sendOnEnter = true }: ComposerProps) {
  const [value, setValue] = useState('')
  const submit = () => {
    const t = value.trim()
    if (!t || disabled) return
    onSend(t)
    setValue('')
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (sendOnEnter && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }
  return (
    <div className={`ac-composer${className ? ' ' + className : ''}`}>
      <textarea
        className="ac-composer-input"
        value={value}
        placeholder={placeholder}
        rows={1}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button className="ac-composer-send" onClick={submit} disabled={disabled || !value.trim()} aria-label="Send">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4Z" />
        </svg>
      </button>
    </div>
  )
}
