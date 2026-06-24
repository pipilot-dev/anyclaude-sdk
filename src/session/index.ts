// Session persistence + resume for browser-claude-sdk.
//
// SessionStore persists per-session metadata and the full LLM transcript to
// IndexedDB (via Dexie), enabling listSessions / resume / fork / rename across
// reloads.

export { SessionStore } from './store.js'
export type { SessionMeta, StoredSession, SessionStoreOptions } from './types.js'
