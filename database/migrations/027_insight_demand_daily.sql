-- =============================================================================
-- 027_insight_demand_daily.sql — the demand record Monza keeps, with NO client data (Samer, 2026-10-12:
-- "I want the data about the models, colours and more to be saved and stored, not client data").
--
-- One row per day × brand × channel × what was asked (a car, a colour, a question, a budget band…): how
-- many PEOPLE and how many MESSAGES. No name, no number, no chat, no person id — nothing points back to a
-- customer, and nothing here is deleted when a chat or a person is (no foreign key to any customer table).
-- So the history of which cars and colours people wanted is kept permanently, even after the 12-month
-- clean-up or a person's deletion removes everything about them.
--
-- Written by lib/insights/demand-server.ts from the labels (sales_signals / sales_observations): nightly for
-- the last 30 days (re-reads change recent days), on demand for every day the labels still cover. A day is
-- rewritten whole (delete + insert), so a value that disappears does not linger.
--
-- ADDITIVE ONLY. RLS ON, NO POLICIES: service role only.
-- =============================================================================

create table if not exists public.insight_demand_daily (
  day        date not null,
  brand      text not null check (brand in ('voyah', 'mhero', 'monza')),
  channel    text not null check (channel in ('whatsapp', 'instagram', 'facebook')),
  dimension  text not null check (dimension ~ '^[a-z_]{1,30}$'),
  model      text not null default '' check (model = '' or model ~ '^[A-Z0-9_]{1,20}$'),
  value      text not null check (value ~ '^[A-Za-z0-9_:]{1,60}$'),
  people     integer not null check (people >= 0),
  messages   integer not null check (messages >= 0),
  computed_at timestamptz not null default now(),
  primary key (day, brand, channel, dimension, model, value)
);
create index if not exists insight_demand_daily_dim_idx on public.insight_demand_daily (dimension, day);
alter table public.insight_demand_daily enable row level security;

-- Applied as a second step the same day (migration "insight_demand_period"): people can only be counted once
-- over a whole MONTH from that month's labels — adding up days counts a person once per day — so monthly rows
-- are stored too (period 'month', day = the first of the month).
alter table public.insight_demand_daily add column if not exists period text not null default 'day' check (period in ('day', 'month'));
alter table public.insight_demand_daily drop constraint if exists insight_demand_daily_pkey;
alter table public.insight_demand_daily add primary key (period, day, brand, channel, dimension, model, value);
