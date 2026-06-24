// Session persistence + resume for browser-claude-sdk.
//
// SessionStore persists per-session metadata and the full LLM transcript to
// IndexedDB (via Dexie), enabling listSessions / resume / fork / rename across
// reloads.

export { SessionStore } from './store.js'
export type { SessionMeta, StoredSession, SessionStoreOptions, SessionStoreLike } from './types.js'

// Pluggable backends for the survivor / serverless persistence (structural
// clients — the DB packages stay optional).
export { KVSessionStore, type KVClientLike } from './adapters/kv.js'
export { RedisSessionStore, type RedisClientLike } from './adapters/redis.js'
export { PostgresSessionStore, POSTGRES_SCHEMA, type PgRunnerLike } from './adapters/postgres.js'
export { SupabaseSessionStore, SUPABASE_SCHEMA, type SupabaseClientLike } from './adapters/supabase.js'
