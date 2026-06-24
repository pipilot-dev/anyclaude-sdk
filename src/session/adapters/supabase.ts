// SupabaseSessionStore — back sessions with Supabase (@supabase/supabase-js).
//
//   import { createClient } from '@supabase/supabase-js'
//   const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
//   const store = new SupabaseSessionStore(supabase)
//   query({ sessionStore: store, sessionId, resume: true, continueRun: true, … })
//
// Create the table with SUPABASE_SCHEMA (Supabase SQL editor). `transcript` is
// jsonb — the client serializes/parses it for you.
import type { ChatMsg } from '../../types/index.js'
import type { SessionMeta, SessionStoreLike, StoredSession } from '../types.js'

export const SUPABASE_SCHEMA = `
create table if not exists sessions (
  id            text primary key,
  title         text,
  model         text,
  created_at    bigint not null,
  updated_at    bigint not null,
  message_count int not null default 0,
  transcript    jsonb not null default '[]'::jsonb
);
create index if not exists sessions_updated_at_idx on sessions (updated_at desc);
`.trim()

interface SessionRow {
  id: string
  title: string | null
  model: string | null
  created_at: number
  updated_at: number
  message_count: number
  transcript: ChatMsg[]
}

interface SupaResp<T> {
  data: T | null
  error: { message: string } | null
}
interface SupaQuery<T> extends PromiseLike<SupaResp<T[]>> {
  select(columns?: string): SupaQuery<T>
  eq(column: string, value: unknown): SupaQuery<T>
  order(column: string, options?: { ascending?: boolean }): SupaQuery<T>
  single(): PromiseLike<SupaResp<T>>
}
interface SupaTable<T> {
  select(columns?: string): SupaQuery<T>
  upsert(values: Partial<T> | Partial<T>[]): PromiseLike<SupaResp<T[]>>
  update(values: Partial<T>): SupaQuery<T>
  delete(): SupaQuery<T>
}
/** Structural view of a @supabase/supabase-js client. */
export interface SupabaseClientLike {
  from(relation: string): SupaTable<SessionRow>
}

const toMeta = (r: SessionRow): SessionMeta => ({
  sessionId: r.id,
  title: r.title ?? undefined,
  model: r.model ?? undefined,
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
  messageCount: Number(r.message_count),
})

export class SupabaseSessionStore implements SessionStoreLike {
  constructor(
    private readonly supabase: SupabaseClientLike,
    private readonly table = 'sessions'
  ) {}

  async get(sessionId: string): Promise<StoredSession | null> {
    const { data } = await this.supabase.from(this.table).select('*').eq('id', sessionId).single()
    if (!data) return null
    return { ...toMeta(data), transcript: Array.isArray(data.transcript) ? data.transcript : [] }
  }

  async load(sessionId: string): Promise<ChatMsg[] | null> {
    const s = await this.get(sessionId)
    return s ? s.transcript : null
  }

  async save(
    sessionId: string,
    transcript: ChatMsg[],
    meta: { title?: string; model?: string } = {}
  ): Promise<void> {
    const now = Date.now()
    const existing = await this.get(sessionId)
    const row: SessionRow = {
      id: sessionId,
      title: meta.title ?? existing?.title ?? null,
      model: meta.model ?? existing?.model ?? null,
      created_at: existing?.createdAt ?? now,
      updated_at: now,
      message_count: transcript.length,
      transcript,
    }
    const { error } = await this.supabase.from(this.table).upsert(row)
    if (error) throw new Error('SupabaseSessionStore.save: ' + error.message)
  }

  async list(): Promise<SessionMeta[]> {
    const { data } = await this.supabase
      .from(this.table)
      .select('id,title,model,created_at,updated_at,message_count')
      .order('updated_at', { ascending: false })
    return (data ?? []).map(toMeta)
  }

  async rename(sessionId: string, title: string): Promise<void> {
    await this.supabase.from(this.table).update({ title, updated_at: Date.now() }).eq('id', sessionId)
  }

  async remove(sessionId: string): Promise<void> {
    await this.supabase.from(this.table).delete().eq('id', sessionId)
  }
}
