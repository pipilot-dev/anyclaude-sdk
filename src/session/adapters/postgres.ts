// PostgresSessionStore — back sessions with Postgres: node-postgres (`pg`),
// Neon serverless, postgres.js, or any `{ query(sql, params) }` runner.
//
//   // node-postgres
//   import { Pool } from 'pg'
//   const pool = new Pool({ connectionString: process.env.DATABASE_URL })
//   const store = new PostgresSessionStore(pool)
//
//   // Neon serverless (HTTP) — wrap the tagged-template `sql` as a runner:
//   import { neon } from '@neondatabase/serverless'
//   const sql = neon(process.env.DATABASE_URL)
//   const store = new PostgresSessionStore({ query: (text, params) => sql.query(text, params).then(rows => ({ rows })) })
//
// Run POSTGRES_SCHEMA once to create the table.
import type { ChatMsg } from '../../types/index.js'
import type { SessionMeta, SessionStoreLike, StoredSession } from '../types.js'

/** Structural Postgres query runner (node-postgres Pool/Client compatible). */
export interface PgRunnerLike {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

export const POSTGRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id            text PRIMARY KEY,
  title         text,
  model         text,
  created_at    bigint NOT NULL,
  updated_at    bigint NOT NULL,
  message_count int NOT NULL DEFAULT 0,
  transcript    jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS sessions_updated_at_idx ON sessions (updated_at DESC);
`.trim()

function toMeta(r: Record<string, unknown>): SessionMeta {
  return {
    sessionId: String(r.id),
    title: (r.title as string) ?? undefined,
    model: (r.model as string) ?? undefined,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    messageCount: Number(r.message_count),
  }
}

export class PostgresSessionStore implements SessionStoreLike {
  constructor(
    private readonly pg: PgRunnerLike,
    private readonly table = 'sessions'
  ) {}

  /** Create the table if it doesn't exist (optional convenience). */
  async migrate(): Promise<void> {
    await this.pg.query(POSTGRES_SCHEMA)
  }

  async load(sessionId: string): Promise<ChatMsg[] | null> {
    const { rows } = await this.pg.query(`SELECT transcript FROM ${this.table} WHERE id = $1`, [sessionId])
    if (!rows.length) return null
    const t = rows[0].transcript
    return (typeof t === 'string' ? JSON.parse(t) : t) as ChatMsg[]
  }

  async get(sessionId: string): Promise<StoredSession | null> {
    const { rows } = await this.pg.query(`SELECT * FROM ${this.table} WHERE id = $1`, [sessionId])
    if (!rows.length) return null
    const r = rows[0]
    const t = r.transcript
    return { ...toMeta(r), transcript: (typeof t === 'string' ? JSON.parse(t) : t) as ChatMsg[] }
  }

  async save(
    sessionId: string,
    transcript: ChatMsg[],
    meta: { title?: string; model?: string } = {}
  ): Promise<void> {
    const now = Date.now()
    await this.pg.query(
      `INSERT INTO ${this.table} (id, title, model, created_at, updated_at, message_count, transcript)
       VALUES ($1, $2, $3, $4, $4, $5, $6::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         title = COALESCE(EXCLUDED.title, ${this.table}.title),
         model = COALESCE(EXCLUDED.model, ${this.table}.model),
         updated_at = EXCLUDED.updated_at,
         message_count = EXCLUDED.message_count,
         transcript = EXCLUDED.transcript`,
      [sessionId, meta.title ?? null, meta.model ?? null, now, transcript.length, JSON.stringify(transcript)]
    )
  }

  async list(): Promise<SessionMeta[]> {
    const { rows } = await this.pg.query(
      `SELECT id, title, model, created_at, updated_at, message_count FROM ${this.table} ORDER BY updated_at DESC`
    )
    return rows.map(toMeta)
  }

  async rename(sessionId: string, title: string): Promise<void> {
    await this.pg.query(`UPDATE ${this.table} SET title = $2, updated_at = $3 WHERE id = $1`, [
      sessionId,
      title,
      Date.now(),
    ])
  }

  async remove(sessionId: string): Promise<void> {
    await this.pg.query(`DELETE FROM ${this.table} WHERE id = $1`, [sessionId])
  }
}
