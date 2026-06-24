import { type ReactNode } from 'react'
import { useAgent, type UseAgentOptions } from '../useAgent.js'
import { Transcript } from './Transcript.js'
import { Composer } from './Composer.js'
import { Working } from './Working.js'

export interface ChatPanelProps extends UseAgentOptions {
  className?: string
  /** Panel title shown in the header. */
  title?: ReactNode
  placeholder?: string
  workingLabel?: string
  renderMarkdown?: (text: string) => ReactNode
  /** Show the tokens · cost · status line in the header. Default true. */
  showStats?: boolean
}

/**
 * A polished chat panel: header (title + live status/tokens/cost) + Transcript +
 * Working + Composer, wired to useAgent. Like <AgentChat> but with a header bar.
 */
export function ChatPanel({ className, title = 'Agent', placeholder, workingLabel, renderMarkdown, showStats = true, ...agentOpts }: ChatPanelProps) {
  const { messages, streamingText, status, tokens, cost, send } = useAgent(agentOpts)
  const running = status !== 'idle'
  return (
    <div className={`ac-chatpanel${className ? ' ' + className : ''}`}>
      <div className="ac-chatpanel-head">
        <span className="ac-chatpanel-title">{title}</span>
        {showStats && (
          <span className="ac-chatpanel-stats">
            <span className={'ac-status ac-status-' + status}>{status}</span>
            {tokens ? <span className="ac-stat"> · {tokens.toLocaleString()} tok</span> : null}
            {cost ? <span className="ac-stat"> · ${cost.toFixed(4)}</span> : null}
          </span>
        )}
      </div>
      <Transcript messages={messages} streamingText={streamingText} renderMarkdown={renderMarkdown} />
      <Working active={running} label={workingLabel} paused={status === 'paused'} />
      <Composer onSend={send} placeholder={placeholder} disabled={running} />
    </div>
  )
}
