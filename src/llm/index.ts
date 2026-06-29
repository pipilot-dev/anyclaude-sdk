export * from './openai.js'
export * from './anthropic.js'
export * from './responses.js'
// Inline tool-call parsing — recover tool calls a model emitted as TEXT
// (e.g. weak models that narrate tool calls instead of using native function calls).
export { hasInlineToolCalls, parseInlineToolCalls } from './inlineTools.js'
// Tool-call dialects — pluggable parsers for the inline formats cheap/open
// models use (xml-function, hermes, json-fence) when they skip native tool_calls.
export {
  parseToolCalls,
  hasToolCalls,
  dialects,
  DEFAULT_DIALECTS,
  xmlFunctionDialect,
  hermesDialect,
  jsonFenceDialect,
  type ToolDialect,
  type ParsedToolCalls,
} from './dialects.js'
// Model profiles — per-model quirks (dialects, tool_choice, parallel, temperature,
// guidance) for reliable tool use across the long tail of OpenAI-compatible endpoints.
export {
  profileForModel,
  toolGuidancePrompt,
  builtinProfiles,
  genericProfile,
  type ModelProfile,
} from './profiles.js'
// Tool-call repair — validate args before executing and feed the model a
// corrective tool_result so it self-heals (the big reliability win for weak models).
export { validateToolArguments, schemaHint, type ArgValidation } from './repair.js'
export {
  withRetry,
  resolveRetry,
  isRetryableStatus,
  parseRetryAfter,
  HttpError,
  noRetry,
  type RetryPolicy,
} from './retry.js'
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
