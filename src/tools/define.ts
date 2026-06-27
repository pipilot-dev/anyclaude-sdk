// Ergonomic factory for user-defined tools. Wraps a name + description + JSON
// Schema parameters + a run() execution method into the internal `Tool` shape,
// so callers don't need to hand-write the OpenAI function-call `ToolDef`.
//
//   const weather = defineTool({
//     name: 'get_weather',
//     description: 'Current weather for a city',
//     parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
//     run: async ({ city }, ctx) => ({ content: await fetchWeather(String(city)) }),
//   })
//   query({ extraTools: [weather], ... })  // added alongside the builtins
import type { Tool, ToolContext, ToolResult } from './types.js'

export interface DefineToolSpec {
  /** Tool name the model calls (snake_case recommended). */
  name: string
  /** Natural-language description shown to the model. */
  description: string
  /** Argument schema: JSON-Schema `properties` + optional `required`. Defaults to no args. */
  parameters?: { properties: Record<string, unknown>; required?: string[] }
  /** Execution method. Receives the parsed input + the tool context (fs/exec/cwd/signal/…).
   *  OMIT it to make this a CLIENT/delegated tool — the agent loop emits a
   *  client_tool_request and the host executes it (resume with clientToolResults). */
  run?: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult> | ToolResult
  /** Optional: spill threshold for large outputs (see Tool.maxResultChars). */
  maxResultChars?: number
  /** Defer out of the per-turn payload — discoverable via `tool_search`, armed on
   *  demand. For large pools of rarely-used tools (see Tool.defer). */
  defer?: boolean
}

/** Build a `Tool` from a friendly spec. */
export function defineTool(spec: DefineToolSpec): Tool {
  const tool: Tool = {
    def: {
      type: 'function',
      function: {
        name: spec.name,
        description: spec.description,
        parameters: {
          type: 'object',
          properties: spec.parameters?.properties ?? {},
          ...(spec.parameters?.required ? { required: spec.parameters.required } : {}),
        },
      },
    },
  }
  // With a run → server-executed. Without → client-delegated (no run on the Tool).
  if (spec.run) tool.run = async (input, ctx) => spec.run!(input, ctx)
  if (spec.maxResultChars !== undefined) tool.maxResultChars = spec.maxResultChars
  if (spec.defer) tool.defer = true
  return tool
}
