import { useState } from 'react'

export interface ToolResultLike {
  content: unknown
  isError?: boolean
}

export interface ToolCallProps {
  name: string
  input?: Record<string, unknown>
  result?: ToolResultLike
  className?: string
  /** Start expanded. Default false. */
  defaultExpanded?: boolean
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === 'object' && 'text' in b ? String((b as { text?: string }).text ?? '') : '[…]'))
      .join('\n')
  }
  return content == null ? '' : JSON.stringify(content)
}

/** A collapsible tool call + its result. */
export function ToolCall({ name, input, result, className, defaultExpanded = false }: ToolCallProps) {
  const [open, setOpen] = useState(defaultExpanded)
  const summary = result ? resultText(result.content).split('\n')[0].slice(0, 120) : 'running…'
  return (
    <div className={`ac-tool${result?.isError ? ' ac-tool-error' : ''}${className ? ' ' + className : ''}`}>
      <button className="ac-tool-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="ac-tool-caret" aria-hidden>{open ? '▾' : '▸'}</span>
        <span className="ac-tool-name">{name}</span>
        {!open && <span className="ac-tool-summary">{summary}</span>}
      </button>
      {open && (
        <div className="ac-tool-body">
          {input && Object.keys(input).length > 0 && (
            <pre className="ac-tool-args"><code>{JSON.stringify(input, null, 2)}</code></pre>
          )}
          {result && (
            <pre className={`ac-tool-result${result.isError ? ' ac-tool-result-error' : ''}`}>
              <code>{resultText(result.content)}</code>
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
