// Teammate/coordinator MVP: shared in-memory mailbox + task board, the tools
// the coordinator uses to delegate, and the coordinator system-prompt addendum.

export { Mailbox, type AgentMessage } from './mailbox.js'
export {
  BroadcastChannelMailbox,
  type ChannelLike,
  type BroadcastChannelMailboxOptions,
} from './broadcast-mailbox.js'
export { TaskBoard, type BoardTask, type TaskStatus } from './taskBoard.js'
export {
  TEAM_TOOLS,
  sendMessage,
  taskCreate,
  taskUpdate,
  taskGet,
  boardList,
} from './tools.js'
export { coordinatorPrompt } from './prompt.js'
export {
  runTeamLoop,
  type SpawnWorker,
  type TeamLoopOptions,
  type TeamLoopResult,
} from './runner.js'
export { dispatchTasks } from './dispatch.js'
import { dispatchTasks } from './dispatch.js'
import type { Tool } from '../tools/types.js'
/** The dispatch tool, kept separate from TEAM_TOOLS so the agent can merge it in. */
export const TEAM_DISPATCH_TOOLS: Tool[] = [dispatchTasks]
