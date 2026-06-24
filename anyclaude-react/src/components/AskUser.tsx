import { useState } from 'react'

export interface AskUserQuestion {
  question: string
  header?: string
  options: Array<{ label: string; description?: string }>
  multiSelect?: boolean
}

export interface AskUserProps {
  question: AskUserQuestion
  /** Called with the chosen label (single) or labels (multiSelect). */
  onAnswer: (answer: string | string[]) => void
  className?: string
}

/**
 * Renders an `ask_user_question` prompt as option buttons and resolves the
 * answer. Wire it to the SDK's `onAskUser` handler: store the question + a
 * resolver in state, render <AskUser>, and call the resolver from onAnswer.
 */
export function AskUser({ question, onAnswer, className }: AskUserProps) {
  const [selected, setSelected] = useState<string[]>([])
  const multi = !!question.multiSelect

  const toggle = (label: string) => setSelected((s) => (s.includes(label) ? s.filter((l) => l !== label) : [...s, label]))

  return (
    <div className={`ac-askuser${className ? ' ' + className : ''}`}>
      {question.header && <span className="ac-askuser-header">{question.header}</span>}
      <div className="ac-askuser-question">{question.question}</div>
      <div className="ac-askuser-options">
        {question.options.map((o) => {
          const isSel = selected.includes(o.label)
          return (
            <button
              key={o.label}
              className={'ac-askuser-option' + (isSel ? ' ac-selected' : '')}
              onClick={() => (multi ? toggle(o.label) : onAnswer(o.label))}
            >
              <span className="ac-askuser-label">{o.label}</span>
              {o.description && <span className="ac-askuser-desc">{o.description}</span>}
            </button>
          )
        })}
      </div>
      {multi && (
        <button className="ac-askuser-submit" disabled={!selected.length} onClick={() => onAnswer(selected)}>
          Submit{selected.length ? ` (${selected.length})` : ''}
        </button>
      )}
    </div>
  )
}
