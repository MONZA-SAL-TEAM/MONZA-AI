-- =============================================================================
-- 000_core.sql — MONZA AI's own database.
--
-- A SEPARATE Supabase project from the Monza CRM, deliberately: the AI's
-- memory is not a system of record, and the systems of record are not the
-- AI's memory. User identity is the CRM's auth.users id, carried here as an
-- opaque uuid (crm_user_id) — verified server-side against the CRM project on
-- every request, never trusted from the client.
--
-- Everything is written by the server with the service role; RLS here is a
-- second line of defence, closed by default.
-- =============================================================================

create table if not exists public.conversations (
  id           uuid primary key default gen_random_uuid(),
  crm_user_id  uuid not null,
  title        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  archived_at  timestamptz
);
create index if not exists conversations_user_idx
  on public.conversations (crm_user_id, updated_at desc);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role            text not null check (role in ('user','assistant')),
  content         text,
  /** The tool calls this assistant turn made: what, with what input, how many
      rows came back, and whether anything was denied. The transparency trace. */
  tool_trace      jsonb not null default '[]'::jsonb,
  model           text,
  created_at      timestamptz not null default now()
);
create index if not exists messages_conversation_idx
  on public.messages (conversation_id, created_at);

-- Which systems are wired up, and their non-secret configuration. Secrets stay
-- in the server environment; this table records presence, never values.
create table if not exists public.connections (
  connector_key text primary key,
  label         text not null,
  enabled       boolean not null default true,
  config        jsonb not null default '{}'::jsonb,
  updated_at    timestamptz not null default now()
);

-- LAYER 1 of the two-layer model: may this user use this tool through the AI?
-- Deny wins; absence falls back to the capability mapping in the kernel.
create table if not exists public.tool_permissions (
  id            uuid primary key default gen_random_uuid(),
  crm_user_id   uuid not null,
  connector_key text not null,
  tool_name     text not null default '*',
  effect        text not null check (effect in ('allow','deny')),
  note          text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  unique (crm_user_id, connector_key, tool_name)
);
create index if not exists tool_permissions_user_idx
  on public.tool_permissions (crm_user_id);

-- Every tool call the AI ever makes, allowed or denied. This is the answer to
-- "what did the AI look at, on whose behalf, and when".
create table if not exists public.audit_logs (
  id              uuid primary key default gen_random_uuid(),
  crm_user_id     uuid not null,
  conversation_id uuid,
  turn_id         uuid,
  connector_key   text not null,
  tool_name       text not null,
  input           jsonb not null default '{}'::jsonb,
  allowed         boolean not null,
  deny_reason     text,
  row_count       integer,
  error           text,
  duration_ms     integer,
  created_at      timestamptz not null default now()
);
create index if not exists audit_logs_user_idx
  on public.audit_logs (crm_user_id, created_at desc);
create index if not exists audit_logs_tool_idx
  on public.audit_logs (connector_key, tool_name, created_at desc);

-- Settings, same pattern as One Thread: the model id is configuration.
create table if not exists public.ai_settings (
  key        text primary key,
  value      text,
  note       text,
  updated_at timestamptz not null default now()
);

insert into public.ai_settings (key, value, note) values
  ('monza_ai.model', 'claude-opus-5', 'The assistant model. Configuration, never a literal in code.'),
  ('monza_ai.max_tool_calls_per_turn', '8', 'Circuit breaker: one question may fan out to at most this many tool calls.'),
  ('monza_ai.enabled', 'true', 'Kill switch for the whole assistant.')
on conflict (key) do nothing;

-- Closed by default. The app's server routes use the service role; nothing
-- else can read anything.
alter table public.conversations   enable row level security;
alter table public.messages        enable row level security;
alter table public.connections     enable row level security;
alter table public.tool_permissions enable row level security;
alter table public.audit_logs      enable row level security;
alter table public.ai_settings     enable row level security;
