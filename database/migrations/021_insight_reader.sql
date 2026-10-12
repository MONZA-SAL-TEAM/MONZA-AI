-- =============================================================================
-- 021_insight_reader.sql — the insights READER: every customer message read IN ITS CONVERSATION, and
-- what it says broken into typed facts (Samer, 2026-10-12: "I want to know all data of clients and
-- leads … what they most like: colour, car model and more").
--
-- ADDITIVE ONLY: columns added to sales_signals (020), new tables, nothing changed or dropped.
--
--   sales_observations    one row per typed fact: a car named / compared / rejected, a colour wanted /
--                         asked / rejected (exterior or interior, tied to a car), and later budget,
--                         timeline, city, competitor, trade-in, concern. `value` is a CLOSED vocabulary
--                         (checked by the database): no free text — and so no customer words — can land.
--   insight_reader_state  per conversation, what the reader remembers between messages (car codes,
--                         colour ids — labels only), so "do you have it in white?" keeps its car.
--   insight_backfill_runs resumable jobs (cursors, counts, error CODES — never a message).
--   insight_meta_threads  Instagram / Facebook threads already read, so a nightly read skips them.
--   channel_conversations.meta_conversation_id: so evidence links can open Instagram/Facebook chats.
--
-- Labels are KEPT LONGER than the 12-month chat retention (Samer, 2026-10-12): they hold no words. They
-- still go when a person is deleted (every table cascades from channel_conversations).
-- RLS ON, NO POLICIES: service role only, like every table here.
-- =============================================================================

alter table public.sales_signals
  add column if not exists reader_version smallint not null default 1,
  add column if not exists source text not null default 'webhook' check (source in ('webhook', 'whatsapp_rebuild', 'meta_backfill')),
  add column if not exists context_models text[] not null default '{}' check (cardinality(context_models) <= 8),
  add column if not exists needs text[] not null default '{}' check (cardinality(needs) <= 12),
  add column if not exists owner_support boolean not null default false,
  add column if not exists ended boolean not null default false;

create table if not exists public.sales_observations (
  id                   uuid primary key default gen_random_uuid(),
  signal_id            uuid not null references public.sales_signals(id) on delete cascade,
  conversation_id      uuid not null references public.channel_conversations(id) on delete cascade,
  account_id           text not null,
  brand                public.monza_brand not null,
  channel              text not null check (channel in ('whatsapp', 'instagram', 'facebook')),
  at                   timestamptz not null,
  external_message_id  text not null check (char_length(external_message_id) <= 200),
  kind                 text not null check (kind in ('model', 'colour', 'budget', 'timeline', 'purpose', 'city', 'competitor', 'trade_in', 'financing', 'need', 'concern')),
  stance               text check (stance in ('named', 'compared', 'wants', 'asked', 'rejects', 'no_preference', 'owns', 'trading_in', 'mentioned')),
  model                text check (model ~ '^[A-Z0-9_]{1,20}$'),
  binding              text check (binding in ('same_clause', 'only_car_named', 'conversation', 'ad', 'none')),
  part                 text check (part in ('exterior', 'interior')),
  value                text not null check (value ~ '^[a-z0-9_]{1,40}$'),
  detail               text check (detail ~ '^[A-Za-z0-9 ]{1,40}$'),
  amount_min           numeric check (amount_min >= 0),
  amount_max           numeric check (amount_max >= 0),
  currency             text check (currency in ('USD', 'LBP', 'EUR')),
  amount_kind          text check (amount_kind in ('total', 'monthly', 'down_payment')),
  months               smallint check (months between 1 and 120),
  rule                 text not null check (rule ~ '^[a-z0-9_.]{1,60}$'),
  reader_version       smallint not null default 1,
  created_at           timestamptz not null default now(),
  constraint sales_observations_account_fk foreign key (account_id, brand) references public.channel_accounts(id, brand) on delete cascade
);
create index if not exists sales_observations_conv_idx on public.sales_observations (conversation_id, at);
create index if not exists sales_observations_kind_idx on public.sales_observations (kind, value);
create index if not exists sales_observations_model_idx on public.sales_observations (model);
create index if not exists sales_observations_at_idx on public.sales_observations (at desc);
alter table public.sales_observations enable row level security;

-- Re-reading a conversation replaces its facts in one statement: never half old, half new.
create or replace function public.insight_replace_observations(p_signal_ids uuid[], p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.sales_observations where signal_id = any(p_signal_ids);
  insert into public.sales_observations (
    signal_id, conversation_id, account_id, brand, channel, at, external_message_id, kind, stance, model,
    binding, part, value, detail, amount_min, amount_max, currency, amount_kind, months, rule, reader_version
  )
  select
    (r->>'signal_id')::uuid, (r->>'conversation_id')::uuid, r->>'account_id', (r->>'brand')::public.monza_brand,
    r->>'channel', (r->>'at')::timestamptz, r->>'external_message_id', r->>'kind', r->>'stance', r->>'model',
    r->>'binding', r->>'part', r->>'value', r->>'detail', (r->>'amount_min')::numeric, (r->>'amount_max')::numeric,
    r->>'currency', r->>'amount_kind', (r->>'months')::smallint, r->>'rule', coalesce((r->>'reader_version')::smallint, 1)
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r
  where (r->>'signal_id')::uuid = any(p_signal_ids);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.insight_replace_observations(uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.insight_replace_observations(uuid[], jsonb) to service_role;

create table if not exists public.insight_reader_state (
  conversation_id           uuid primary key references public.channel_conversations(id) on delete cascade,
  account_id                text not null,
  brand                     public.monza_brand not null,
  state                     jsonb not null check (state ? 'version'),
  last_at                   timestamptz not null,
  last_external_message_id  text check (char_length(last_external_message_id) <= 200),
  reader_version            smallint not null default 1,
  updated_at                timestamptz not null default now(),
  constraint insight_reader_state_account_fk foreign key (account_id, brand) references public.channel_accounts(id, brand) on delete cascade
);
alter table public.insight_reader_state enable row level security;

create table if not exists public.insight_backfill_runs (
  id               text primary key check (id ~ '^[a-z0-9:_-]{1,60}$'),
  account_id       text,
  state            text not null default 'running' check (state in ('running', 'done', 'blocked')),
  cursor           text check (char_length(cursor) <= 2000),
  threads_seen     integer not null default 0,
  messages_read    integer not null default 0,
  signals_written  integer not null default 0,
  matched_existing integer not null default 0,
  last_error_code  text check (char_length(last_error_code) <= 60),
  started_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  finished_at      timestamptz
);
alter table public.insight_backfill_runs enable row level security;

create table if not exists public.insight_meta_threads (
  account_id            text not null,
  meta_conversation_id  text not null check (meta_conversation_id ~ '^[A-Za-z0-9_=.:-]{1,200}$'),
  conversation_id       uuid references public.channel_conversations(id) on delete cascade,
  meta_updated_at       timestamptz,
  read_at               timestamptz not null default now(),
  messages_read         integer not null default 0,
  primary key (account_id, meta_conversation_id)
);
alter table public.insight_meta_threads enable row level security;

alter table public.channel_conversations
  add column if not exists meta_conversation_id text check (meta_conversation_id ~ '^[A-Za-z0-9_=.:-]{1,200}$');
create unique index if not exists channel_conversations_meta_conv_uniq
  on public.channel_conversations (account_id, meta_conversation_id) where meta_conversation_id is not null;
