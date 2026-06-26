// anyclaude-react — restylable React UI kit for anyclaude-sdk.
export { createAgentClient, createEndpointClient } from './client.js'
export {
  createWorkspaceClientTools,
  createWebContainerClientTools,
  type WorkspaceLike,
  type WorkspaceClientToolsOptions,
} from './workspaceTools.js'
export type {
  AgentClient,
  RunFn,
  RunOptions,
  EndpointClientOptions,
  ClientToolMap,
  ClientToolExecutor,
  ClientToolResult,
} from './client.js'

export { useAgent } from './useAgent.js'
export type { UseAgentOptions, UseAgentResult, AgentStatus } from './useAgent.js'

export { renderMarkdown } from './markdown.js'

export { Message, MarkdownMessage } from './components/Message.js'
export type { MessageProps, MarkdownMessageProps } from './components/Message.js'
export { ToolCall } from './components/ToolCall.js'
export type { ToolCallProps, ToolResultLike } from './components/ToolCall.js'
export { Composer } from './components/Composer.js'
export type { ComposerProps } from './components/Composer.js'
export { Working } from './components/Working.js'
export type { WorkingProps } from './components/Working.js'
export { Transcript } from './components/Transcript.js'
export type { TranscriptProps } from './components/Transcript.js'
export { AgentChat } from './components/AgentChat.js'
export type { AgentChatProps } from './components/AgentChat.js'
export { ChatPanel } from './components/ChatPanel.js'
export type { ChatPanelProps } from './components/ChatPanel.js'

export { FileExplorer } from './components/FileExplorer.js'
export type { FileExplorerProps, FileEntry } from './components/FileExplorer.js'
export { AskUser } from './components/AskUser.js'
export type { AskUserProps, AskUserQuestion } from './components/AskUser.js'

// Heavy IDE components (Terminal → @xterm/*, CodeEditor → codemirror) live on a
// subpath so this root barrel stays dependency-light:
//   import { Terminal, CodeEditor } from 'anyclaude-react/ide'
