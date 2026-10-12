-- =============================================================================
-- 022_lead_ownership.sql — who owns a lead, and when each side of a chat spoke (Samer, 2026-10-12:
-- "Take this lead" — sales take and release their own; managers and the owner also assign).
--
-- ADDITIVE ONLY.
--
--   channel_conversations.assigned_at / assigned_by / assigned_name   (assigned_to exists since 003)
--   conversation_owner_events   every take / release / assign, by whom, from whom, to whom
--   channel_turns               WHEN a message was sent and by which side — never its words. Instagram and
--                               Facebook replies sent from MONZA AI and turns read for insights land here, so
--                               response times exist for every channel. Kept apart from channel_messages so the
--                               alert auto-close (sales-ops.ts closeAnswered) is not affected.
--
-- Taking a lead is race-safe in the application: one UPDATE … WHERE assigned_to IS NULL.
-- RLS ON, NO POLICIES: service role only, like every table here.
-- =============================================================================

alter table public.channel_conversations
  add column if not exists assigned_at   timestamptz,
  add column if not exists assigned_by   uuid,
  add column if not exists assigned_name text check (char_length(assigned_name) <= 120);
create index if not exists channel_conversations_assigned_idx
  on public.channel_conversations (assigned_to) where assigned_to is not null;

create table if not exists public.conversation_owner_events (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.channel_conversations(id) on delete cascade,
  account_id      text not null,
  action          text not null check (action in ('take', 'release', 'assign')),
  from_staff      uuid,
  from_name       text check (char_length(from_name) <= 120),
  to_staff        uuid,
  to_name         text check (char_length(to_name) <= 120),
  by_staff        uuid not null,
  by_name         text check (char_length(by_name) <= 120),
  at              timestamptz not null default now()
);
create index if not exists conversation_owner_events_conv_idx on public.conversation_owner_events (conversation_id, at desc);
alter table public.conversation_owner_events enable row level security;

create table if not exists public.channel_turns (
  id                   uuid primary key default gen_random_uuid(),
  conversation_id      uuid not null references public.channel_conversations(id) on delete cascade,
  account_id           text not null,
  channel              text not null check (channel in ('whatsapp', 'instagram', 'facebook')),
  direction            text not null check (direction in ('in', 'out')),
  author               text not null check (author in ('customer', 'staff', 'automation')),
  staff_id             uuid,
  external_message_id  text not null check (char_length(external_message_id) <= 200),
  at                   timestamptz not null,
  source               text not null default 'send' check (source in ('send', 'meta_backfill')),
  created_at           timestamptz not null default now(),
  unique (account_id, external_message_id)
);
create index if not exists channel_turns_conv_idx on public.channel_turns (conversation_id, at);
create index if not exists channel_turns_at_idx on public.channel_turns (at desc);
alter table public.channel_turns enable row level security;
