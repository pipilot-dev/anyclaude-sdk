// Sandbox providers — pluggable backends implementing the `Sandbox`
// (FileSystem + CommandExecutor) interface.
//
// Supported: WebContainer, E2B, Vercel Sandbox, Daytona, Cloudflare Sandbox.
// Each adapter wraps the provider's client structurally (no hard SDK dependency
// — install only the provider you use). `composeWorkspace` mixes any FileSystem
// with any CommandExecutor.

export * from './types.js'
export {
  LocalSandbox,
  createLocalSandbox,
  detectPlatform,
  type Platform,
  type LocalSandboxOptions,
} from './local.js'
export { E2BSandbox, createE2BSandbox, type E2BClientLike } from './e2b.js'
export { VercelSandbox, createVercelSandbox, type VercelClientLike } from './vercel.js'
export { DaytonaSandbox, createDaytonaSandbox, type DaytonaClientLike } from './daytona.js'
export {
  CloudflareSandbox,
  createCloudflareSandbox,
  type CloudflareClientLike,
} from './cloudflare.js'

// WebContainer lives in workspace/ but is re-exported here so every sandbox
// provider is reachable from a single import.
export { WebContainerWorkspace, type WebContainerLike } from '../workspace/webcontainer.js'
// NoopCommandExecutor (a CommandExecutor that refuses to run anything) pairs
// with composeWorkspace for file-only agents.
export { NoopCommandExecutor } from '../workspace/memory.js'
