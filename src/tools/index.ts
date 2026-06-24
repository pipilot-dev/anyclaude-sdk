// Public tool registry for browser-claude-sdk.
import type { ToolDef } from '../types/index.js'
import { bash } from './bash.js'
import { deleteFile } from './delete_file.js'
import { editFile } from './edit_file.js'
import { glob } from './glob.js'
import { grep } from './grep.js'
import { listFiles } from './list_files.js'
import { multiEdit } from './multi_edit.js'
import { notebookEdit } from './notebook_edit.js'
import { readFile } from './read_file.js'
import { todoWrite } from './todo_write.js'
import type { Tool } from './types.js'
import { webFetch } from './web_fetch.js'
import { webSearch } from './web_search.js'
import { toolSearch } from './tool_search.js'
import { config } from './config.js'
import { writeFile } from './write_file.js'

export type { Tool, ToolContext, ToolResult, FileReadLimits } from './types.js'
export { bash, readFile, writeFile, editFile, deleteFile, listFiles, glob, grep }
export { multiEdit, notebookEdit, todoWrite, webFetch, webSearch, toolSearch, config }
export { walk, globToRegExp, joinPath, DEFAULT_IGNORE } from './walk.js'
export { defineTool, type DefineToolSpec } from './define.js'
export { askUserQuestion } from './ask_user.js'

/** Every built-in Claude Code tool, ready to pass to `query()`. */
export const ALL_CLAUDE_CODE_TOOLS: Tool[] = [
  bash,
  readFile,
  writeFile,
  editFile,
  multiEdit,
  deleteFile,
  listFiles,
  glob,
  grep,
  notebookEdit,
  todoWrite,
  webFetch,
  webSearch,
  toolSearch,
  config,
]

/** Extract the OpenAI-shape definitions to send to the LLM. */
export function toolDefs(tools: Tool[]): ToolDef[] {
  return tools.map((t) => t.def)
}

/** Build a name→tool lookup for dispatching tool calls. */
export function toolByName(tools: Tool[]): Map<string, Tool> {
  return new Map(tools.map((t) => [t.def.function.name, t]))
}
