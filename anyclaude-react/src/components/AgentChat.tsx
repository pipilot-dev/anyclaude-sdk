import { type ReactNode } from 'react'
import { useAgent, type UseAgentOptions } from '../useAgent.js'
import { Transcript } from './Transcript.js'
import { Composer } from './Composer.js'
import { Working } from './Working.js'

export interface AgentChatProps extends UseAgentOptions {
  className?: string
  placeholder?: string
  workingLabel?: string
  /** Override markdown rendering in the transcript. */
  renderMarkdown?: (text: string) => ReactNode
  /** Optional header rendered above the transcript. */
  header?: ReactNode
}

/** All-in-one chat surface: Transcript + Working + Composer, wired to useAgent. */
export function AgentChat({ className, placeholder, workingLabel, renderMarkdown, header, ...agentOpts }: AgentChatProps) {
  const { messages, streamingText, status, send } = useAgent(agentOpts)
  const running = status !== 'idle'
  return (
    <div className={`ac-chat${className ? ' ' + className : ''}`}>
      {header}
      <Transcript messages={messages} streamingText={streamingText} renderMarkdown={renderMarkdown} />
      <Working active={running} label={workingLabel} paused={status === 'paused'} />
      <Composer onSend={send} placeholder={placeholder} />
    </div>
  )
}
