-- =============================================================================
-- 023_insight_people.sql — one row per PERSON: everything the reader learnt about them, as labels, so the
-- Research Lab can filter thousands of people in one query (Samer, 2026-10-12: "I want to know all data of
-- clients and leads").
--
-- ADDITIVE ONLY. Rebuilt from sales_signals + sales_observations by lib/insights/people-server.ts (nightly,
-- and on "Refresh" in the Lab). NO NAME AND NO PHONE: those are joined at read time from leads /
-- channel_conversations, so they keep following the 12-month rule while these labels are kept longer.
-- Every value is a closed-vocabulary key (the same checks as 021). RLS ON, NO POLICIES.
-- =============================================================================

create table if not exists public.insight_people (
  person_key        text primary key check (person_key ~ '^(lead|chat):[0-9a-f-]{36}$'),
  lead_id           uuid references public.leads(id) on delete cascade,
  conversation_ids  uuid[] not null default '{}',
  channels          text[] not null default '{}',
  brands            text[] not null default '{}',
  first_at          timestamptz not null,
  last_at           timestamptz not null,
  messages          integer not null default 0,
  active_days       integer not null default 0,
  stage             text not null check (stage ~ '^[a-z_]{1,20}$'),
  language          text check (language ~ '^[a-z_]{1,20}$'),
  topics            text[] not null default '{}',
  models            text[] not null default '{}',
  primary_model     text check (primary_model ~ '^[A-Z0-9_]{1,20}$'),
  compared_models   text[] not null default '{}',
  rejected_models   text[] not null default '{}',
  colours_wanted    text[] not null default '{}',
  colours_rejected  text[] not null default '{}',
  interior          text[] not null default '{}',
  budget_band       text check (budget_band ~ '^[a-z0-9_]{1,40}$'),
  budget_min        numeric,
  budget_max        numeric,
  budget_currency   text check (budget_currency in ('USD', 'LBP', 'EUR')),
  timeline          text check (timeline ~ '^[a-z0-9_]{1,40}$'),
  city              text check (city ~ '^[a-z0-9_]{1,40}$'),
  purpose           text[] not null default '{}',
  competitors       text[] not null default '{}',
  concerns          text[] not null default '{}',
  needs             text[] not null default '{}',
  financing         text[] not null default '{}',
  trade_in          boolean not null default false,
  first_touch       text check (first_touch ~ '^[a-z_]{1,20}$'),
  owner_id          uuid,
  waiting           boolean not null default false,
  reader_version    smallint not null default 1,
  updated_at        timestamptz not null default now()
);
create index if not exists insight_people_last_idx on public.insight_people (last_at desc);
create index if not exists insight_people_models_idx on public.insight_people using gin (models);
create index if not exists insight_people_topics_idx on public.insight_people using gin (topics);
create index if not exists insight_people_colours_idx on public.insight_people using gin (colours_wanted);
alter table public.insight_people enable row level security;
