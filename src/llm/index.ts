export * from './openai.js'
export * from './anthropic.js'
export * from './responses.js'
// Inline tool-call parsing — recover tool calls a model emitted as TEXT
// (e.g. weak models that narrate tool calls instead of using native function calls).
export { hasInlineToolCalls, parseInlineToolCalls } from './inlineTools.js'
// Type-only re-export (zero runtime cost) so custom `LLMClient` authors can get
// fully-typed clients from this browser-clean subpath WITHOUT importing the bare
// root (which pulls node:child_process + comlink into a browser bundle).
export type {
  LLMClient,
  ChatMsg,
  StreamResult,
  ToolCall,
  ToolDef,
  StopReason,
  Usage,
  ContentBlockParam,
} from '../types/index.js'
