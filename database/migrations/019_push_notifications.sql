-- =============================================================================
-- 019_push_notifications.sql — notifications when the app is closed (Samer, 2026-09-21:
-- "I'm not receiving notifications outside the app").
--
-- ADDITIVE ONLY: two new tables, nothing changed or dropped.
--
--   push_subscriptions  one row per DEVICE a staff member switched notifications on for. The endpoint
--                       is the address the phone's own push service (Apple, Google, Mozilla) gave it.
--                       It is a capability URL — whoever holds it can make that phone buzz — so, like
--                       every table here: RLS ON, NO POLICIES, service role only.
--   push_outbox         what the last few notifications SAID, so the phone can ask after it is woken
--                       (the push itself carries nothing: no customer's name travels through Apple or
--                       Google). Who and where — never a customer's words. Rows live one day.
-- =============================================================================

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  staff_id    text not null,
  endpoint    text not null unique,
  user_agent  text,
  created_at  timestamptz not null default now(),
  -- The last time a SIGNED-IN staff member opened the app on this device. The sign-in lasts an hour and
  -- a closed phone cannot renew it, so the device's own address is what lets it ask "what happened?" —
  -- but only while this date is recent. A phone nobody has signed in on for a month hears only
  -- "New activity", with no customer's name.
  confirmed_at timestamptz not null default now(),
  last_ok_at  timestamptz,
  failures    integer not null default 0 check (failures >= 0)
);
create index if not exists push_subscriptions_staff_idx on public.push_subscriptions (staff_id);
alter table public.push_subscriptions enable row level security;

create table if not exists public.push_outbox (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  title       text not null check (char_length(title) <= 120),
  body        text not null check (char_length(body) <= 240),
  url         text not null check (url like '/%' and char_length(url) <= 400),
  tag         text not null check (char_length(tag) <= 64)
);
create index if not exists push_outbox_created_idx on public.push_outbox (created_at desc);
alter table public.push_outbox enable row level security;
