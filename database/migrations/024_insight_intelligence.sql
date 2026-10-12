-- =============================================================================
-- 024_insight_intelligence.sql — the insights system, second stage (Samer, 2026-10-12, "MASTER
-- IMPLEMENTATION PROMPT — MONZA AI INSIGHTS & CUSTOMER INTELLIGENCE SYSTEM").
--
-- ADDITIVE ONLY (one check constraint is WIDENED, never narrowed):
--
--   sales_signals.ad_model         the car of the ad the chat came from (a Click-to-WhatsApp headline),
--                                  so "how much is it?" after the COURAGE ad is read as the Courage.
--   sales_observations kinds       + mention (WHICH dictionary word named the car: a key, never the
--                                    customer's text), category (SUV / MPV / electric… with no model),
--                                    unresolved (a car name that could be an ordinary word: kept apart).
--   insight_people                 + ad_model, context_models, categories, unresolved, mentions,
--                                    test_drives_booked, colour_alternatives.
--   insight_saved_queries          the Research Lab's saved studies (a URL query, never results).
--   insight_overrides              corrections from the review queue, keyed by the MESSAGE (account +
--                                  platform id) so they survive every re-read; append-only, the newest
--                                  wins — the table is its own audit trail.
--
-- RLS ON, NO POLICIES: service role only, like every table here.
-- =============================================================================

alter table public.sales_signals
  add column if not exists ad_model text check (ad_model ~ '^[A-Z0-9_]{1,20}$');

alter table public.sales_observations drop constraint if exists sales_observations_kind_check;
alter table public.sales_observations add constraint sales_observations_kind_check
  check (kind in ('model', 'colour', 'budget', 'timeline', 'purpose', 'city', 'competitor', 'trade_in', 'financing', 'need', 'concern', 'mention', 'category', 'unresolved'));
alter table public.sales_observations drop constraint if exists sales_observations_stance_check;
alter table public.sales_observations add constraint sales_observations_stance_check
  check (stance in ('named', 'compared', 'wants', 'asked', 'rejects', 'no_preference', 'owns', 'trading_in', 'mentioned', 'alternative', 'prefers'));

alter table public.insight_people
  add column if not exists ad_model            text check (ad_model ~ '^[A-Z0-9_]{1,20}$'),
  add column if not exists context_models      text[] not null default '{}',
  add column if not exists categories          text[] not null default '{}',
  add column if not exists unresolved          text[] not null default '{}',
  add column if not exists mentions            text[] not null default '{}',
  add column if not exists colour_alternatives text[] not null default '{}',
  add column if not exists test_drives_booked  integer not null default 0,
  add column if not exists customer_type       text check (customer_type ~ '^[a-z_]{1,20}$');
create index if not exists insight_people_ad_idx on public.insight_people (ad_model);

create table if not exists public.insight_saved_queries (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(name) between 1 and 80),
  query            text not null check (char_length(query) <= 2000 and query !~ '[<>]'),
  created_by       uuid not null,
  created_by_name  text check (char_length(created_by_name) <= 120),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.insight_saved_queries enable row level security;

create table if not exists public.insight_overrides (
  id                   uuid primary key default gen_random_uuid(),
  account_id           text not null,
  external_message_id  text not null check (char_length(external_message_id) <= 200),
  kind                 text not null check (kind ~ '^[a-z_]{1,20}$'),
  value                text not null check (value ~ '^[a-z0-9_]{1,40}$'),
  model                text check (model ~ '^[A-Z0-9_]{1,20}$'),
  action               text not null check (action in ('confirm', 'correct', 'mark_unknown')),
  new_value            text check (new_value ~ '^[a-z0-9_]{1,40}$'),
  new_model            text check (new_model ~ '^[A-Z0-9_]{1,20}$'),
  by_staff             uuid not null,
  by_name              text check (char_length(by_name) <= 120),
  at                   timestamptz not null default now()
);
create index if not exists insight_overrides_msg_idx on public.insight_overrides (account_id, external_message_id, at desc);
alter table public.insight_overrides enable row level security;
