-- Run this in the Supabase SQL editor (matches anyclaude-sdk's SUPABASE_SCHEMA).
-- The `transcript` column holds the full conversation as JSONB; the survivor
-- persists it on a paused boundary and reloads it on the continuation request.
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
