-- 028 — The Decision Center, the server-side re-read, and staff activity (Samer, 2026-10-13).
--
-- ADDITIVE ONLY.
--
--   insight_backfill_runs.lease / lease_until / hops  one server-side re-read at a time: each step carries
--                                                     the lease; a second start waits until it expires.
--   insight_decisions        what needs management attention, found by fixed rules (never generated text):
--                            a buyer waiting, a test drive with no booking, demand above stock… Each item has
--                            a state (open → acknowledged / escalated → resolved / dismissed, or cleared by
--                            itself when the condition is gone) and a person. Facts are counts and labels only.
--   insight_decision_events  every change, so the effect of acting on an item can be measured.
--   staff_activity_days      per staff member and Beirut day: seconds ACTIVELY using MONZA AI (the window
--                            visible and used in the last minutes), per section, first and last time seen.
--                            Never a page address, never a customer.
--
-- RLS on, no policies: only the server (service role) reads and writes.

alter table public.insight_backfill_runs
  add column if not exists lease text,
  add column if not exists lease_until timestamptz,
  add column if not exists hops integer not null default 0;

create table if not exists public.insight_decisions (
  id uuid primary key default gen_random_uuid(),
  rule text not null check (rule ~ '^[a-z_]{1,40}$'),
  subject text not null check (char_length(subject) between 1 and 120),
  -- A person's item goes when the person is deleted (privacy).
  conversation_id uuid references public.channel_conversations(id) on delete cascade,
  person_key text check (person_key is null or char_length(person_key) <= 80),
  model text check (model is null or model ~ '^[A-Z0-9_]{1,20}$'),
  severity text not null default 'normal' check (severity in ('critical', 'high', 'normal')),
  state text not null default 'open' check (state in ('open', 'acknowledged', 'escalated', 'resolved', 'dismissed', 'cleared')),
  facts jsonb not null default '{}'::jsonb,
  due_at timestamptz,
  assigned_to uuid,
  assigned_name text check (assigned_name is null or char_length(assigned_name) <= 120),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid,
  closed_name text check (closed_name is null or char_length(closed_name) <= 120)
);
-- One live item per rule and subject; a closed one may come back as a new item.
create unique index if not exists insight_decisions_live on public.insight_decisions (rule, subject) where state in ('open', 'acknowledged', 'escalated');
create index if not exists insight_decisions_state on public.insight_decisions (state, rule);
create index if not exists insight_decisions_closed on public.insight_decisions (rule, subject, closed_at desc);
alter table public.insight_decisions enable row level security;

create table if not exists public.insight_decision_events (
  id bigserial primary key,
  decision_id uuid not null references public.insight_decisions(id) on delete cascade,
  action text not null check (action in ('opened', 'assigned', 'acknowledged', 'escalated', 'resolved', 'dismissed', 'cleared', 'reopened')),
  by_staff uuid,
  by_name text check (by_name is null or char_length(by_name) <= 120),
  to_staff uuid,
  to_name text check (to_name is null or char_length(to_name) <= 120),
  at timestamptz not null default now()
);
create index if not exists insight_decision_events_decision on public.insight_decision_events (decision_id, at);
create index if not exists insight_decision_events_by on public.insight_decision_events (by_staff, at);
alter table public.insight_decision_events enable row level security;

create table if not exists public.staff_activity_days (
  staff_id uuid not null,
  day date not null,
  staff_name text check (staff_name is null or char_length(staff_name) <= 120),
  active_seconds integer not null default 0 check (active_seconds between 0 and 86400),
  sections jsonb not null default '{}'::jsonb,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  primary key (staff_id, day)
);
create index if not exists staff_activity_days_day on public.staff_activity_days (day);
alter table public.staff_activity_days enable row level security;

-- One "I am using the app" ping. The time credited is capped by the wall clock since the last ping, so two
-- open tabs never count double, and by 90 s per ping.
create or replace function public.staff_activity_ping(p_staff uuid, p_name text, p_day date, p_seconds integer, p_section text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_prev timestamptz;
  v_credit integer;
  v_section text := case when p_section ~ '^[a-z_]{1,24}$' then p_section else 'other' end;
begin
  select last_at into v_prev from public.staff_activity_days where staff_id = p_staff and day = p_day for update;
  v_credit := least(greatest(coalesce(p_seconds, 0), 0), 90);
  if v_prev is null then
    insert into public.staff_activity_days (staff_id, day, staff_name, active_seconds, sections, first_at, last_at)
    values (p_staff, p_day, left(p_name, 120), v_credit, jsonb_build_object(v_section, v_credit), now(), now())
    on conflict (staff_id, day) do nothing;
    return;
  end if;
  v_credit := least(v_credit, greatest(0, floor(extract(epoch from (now() - v_prev))))::integer);
  update public.staff_activity_days
     set staff_name = coalesce(left(p_name, 120), staff_name),
         active_seconds = least(86400, active_seconds + v_credit),
         sections = sections || jsonb_build_object(v_section, coalesce((sections ->> v_section)::integer, 0) + v_credit),
         last_at = now()
   where staff_id = p_staff and day = p_day;
end;
$$;
revoke all on function public.staff_activity_ping(uuid, text, date, integer, text) from public, anon, authenticated;
grant execute on function public.staff_activity_ping(uuid, text, date, integer, text) to service_role;
