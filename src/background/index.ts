// Background task system for browser-claude-sdk.
//
// - BackgroundTaskManager: run detached, pollable async work on the main thread
//   (background sub-agents, long shell commands) — no worker required.
// - worker helpers: optional Comlink-based off-main-thread execution.
// - tools: task_list / task_output / task_stop for the agent to manage tasks.

export {
  BackgroundTaskManager,
  type BgTask,
  type BgStatus,
  type BgTaskFn,
} from './manager.js'
export {
  exposeBackgroundWorker,
  wrapWorker,
  type WorkerRunner,
} from './worker.js'
export { taskList, taskOutput, taskStop, BACKGROUND_TOOLS } from './tools.js'
