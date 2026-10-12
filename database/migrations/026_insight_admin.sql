-- =============================================================================
-- 026_insight_admin.sql — what people DECIDE about the insights (Samer, 2026-10-12, the "not built yet" list):
--
--   insight_identity_events   every manual merge ("same person") and split ("not this person") of chats —
--                             who, when, which chat, from which lead to which. The link itself is
--                             lead_conversations with method human_confirmed (005): a person is accountable.
--   insight_aliases           words a manager approved (or rejected) as naming a car, for the INSIGHTS reader
--                             only — never the live sales bot. A dictionary word typed by staff, not a
--                             customer's message.
--   insight_ad_spend          what Monza spent on ads per month, brand and channel — typed by a manager, so
--                             cost per lead can be computed from real figures, never guessed.
--   insight_lead_outcomes     why a lead was lost, recorded by a person from a closed list (the CRM records
--                             no reason). Append-only: the newest record wins; "cleared" withdraws it.
--   insight_people            + lost_reason, colour_switched, brochure_then_quiet (the Lab's studies).
--
-- ADDITIVE ONLY. RLS ON, NO POLICIES: service role only.
-- =============================================================================

create table if not exists public.insight_identity_events (
  id               uuid primary key default gen_random_uuid(),
  action           text not null check (action in ('merge', 'split')),
  conversation_id  uuid not null references public.channel_conversations(id) on delete cascade,
  from_lead        uuid,
  to_lead          uuid,
  by_staff         uuid not null,
  by_name          text check (char_length(by_name) <= 120),
  at               timestamptz not null default now()
);
create index if not exists insight_identity_events_conv_idx on public.insight_identity_events (conversation_id, at desc);
alter table public.insight_identity_events enable row level security;

create table if not exists public.insight_aliases (
  id          uuid primary key default gen_random_uuid(),
  alias       text not null check (char_length(alias) between 1 and 40 and alias !~ '[<>{}]'),
  model       text not null check (model ~ '^[A-Z0-9_]{1,20}$'),
  status      text not null check (status in ('approved', 'rejected')),
  by_staff    uuid not null,
  by_name     text check (char_length(by_name) <= 120),
  at          timestamptz not null default now()
);
create index if not exists insight_aliases_alias_idx on public.insight_aliases (alias, at desc);
alter table public.insight_aliases enable row level security;

create table if not exists public.insight_ad_spend (
  id          uuid primary key default gen_random_uuid(),
  month       date not null check (extract(day from month) = 1),
  brand       text not null check (brand in ('voyah', 'mhero', 'monza')),
  channel     text not null check (channel in ('whatsapp', 'instagram', 'facebook', 'all')),
  amount      numeric not null check (amount >= 0 and amount < 10000000),
  currency    text not null default 'USD' check (currency in ('USD')),
  by_staff    uuid not null,
  by_name     text check (char_length(by_name) <= 120),
  at          timestamptz not null default now(),
  unique (month, brand, channel)
);
alter table public.insight_ad_spend enable row level security;

create table if not exists public.insight_lead_outcomes (
  id           uuid primary key default gen_random_uuid(),
  person_key   text not null check (person_key ~ '^(lead|chat):[0-9a-f-]{36}$'),
  reason       text not null check (reason in ('price_too_high', 'competitor_chosen', 'financing_unavailable', 'vehicle_unavailable', 'colour_unavailable', 'delivery_too_slow', 'charging_concerns', 'warranty_concerns', 'no_follow_up', 'postponed', 'other', 'cleared')),
  by_staff     uuid not null,
  by_name      text check (char_length(by_name) <= 120),
  at           timestamptz not null default now()
);
create index if not exists insight_lead_outcomes_person_idx on public.insight_lead_outcomes (person_key, at desc);
alter table public.insight_lead_outcomes enable row level security;

alter table public.insight_people
  add column if not exists lost_reason          text check (lost_reason ~ '^[a-z_]{1,30}$'),
  add column if not exists colour_switched      boolean not null default false,
  add column if not exists brochure_then_quiet  boolean not null default false;
