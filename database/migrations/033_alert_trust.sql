-- =============================================================================
-- 033 — Alerts a person can trust (Samer, 2026-11-25: "every alert must represent a real issue that
--       someone can take action on today … permanent solutions, not just a one-time cleanup").
--
-- Audited that day, 537 open alerts: 81 second alerts in one chat, 53 already answered, 78 answered
-- but waiting for an outcome (73 of them test drives), 132 Instagram / Facebook nobody can verify,
-- 118 customers silent for over a month, and 75 chats genuinely waiting.
--
-- ADDITIVE: new columns, new tables, one read-only function. It changes NO existing row. The first
-- reconciliation (lib/alerts/reconcile-server.ts) is a separate, approved step, and 034 — the
-- one-open-alert-per-chat index — can only be applied after it.
--
--   sales_alerts.verdict / verdict_at   what the last reconciliation found (lib/alerts/reconcile.ts)
--   sales_alerts.close_reason           why it was closed: a closed vocabulary, never free text
--   sales_alerts.superseded_by          a duplicate's surviving alert
--   sales_alert_events                  the audit trail: raised, merged, reopened, closed, by whom
--   conversation_classes (+ events)     a person's correction of the conversation class
--   test_drive_requests (+ events)      a request from the ask to its outcome
--   lead_assignment_rules               who is in the rotation for new leads (none = nobody)
--   channel_turns.source               gains 'echo': our own Instagram / Facebook replies, as turns
--   alert_chat_facts()                  per chat with an open alert: who spoke last and when
--
-- No customer word is stored by any of this. RLS ON, NO POLICIES: service role only, like every
-- table here.
-- =============================================================================

alter table public.sales_alerts
  add column if not exists verdict       text check (verdict in ('waiting', 'follow_up', 'answered', 'duplicate', 'unverified', 'historical')),
  add column if not exists verdict_at    timestamptz,
  add column if not exists close_reason  text check (close_reason in ('answered', 'duplicate', 'handled', 'answered_elsewhere', 'no_longer_relevant', 'not_a_customer')),
  add column if not exists superseded_by uuid references public.sales_alerts(id) on delete set null;
create index if not exists sales_alerts_open_chat on public.sales_alerts (conversation_ref) where status = 'open';

create table if not exists public.sales_alert_events (
  id        uuid primary key default gen_random_uuid(),
  alert_id  uuid not null references public.sales_alerts(id) on delete cascade,
  at        timestamptz not null default now(),
  action    text not null check (action in ('raised', 'merged', 'reopened', 'auto_closed', 'closed', 'restored')),
  -- A closed vocabulary (reconcile.ts evidence / CLOSE_REASONS), never a customer's word.
  reason    text check (reason ~ '^[a-z_]{1,40}$'),
  by_staff  uuid,
  by_name   text check (char_length(by_name) <= 120)
);
create index if not exists sales_alert_events_alert on public.sales_alert_events (alert_id, at desc);
alter table public.sales_alert_events enable row level security;

create table if not exists public.conversation_classes (
  conversation_id uuid primary key references public.channel_conversations(id) on delete cascade,
  class           text not null check (class in ('ready_to_buy', 'test_drive', 'interested', 'general', 'existing_customer', 'after_sales', 'supplier', 'spam', 'no_action')),
  set_by          uuid not null,
  set_name        text check (char_length(set_name) <= 120),
  set_at          timestamptz not null default now()
);
alter table public.conversation_classes enable row level security;

create table if not exists public.conversation_class_events (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.channel_conversations(id) on delete cascade,
  from_class      text,
  to_class        text,
  by_staff        uuid not null,
  by_name         text check (char_length(by_name) <= 120),
  at              timestamptz not null default now()
);
create index if not exists conversation_class_events_conv on public.conversation_class_events (conversation_id, at desc);
alter table public.conversation_class_events enable row level security;

create table if not exists public.test_drive_requests (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.channel_conversations(id) on delete cascade,
  account_id       text not null,
  models           text[] not null default '{}' check (cardinality(models) <= 8),
  status           text not null default 'requested' check (status in ('requested', 'contacted', 'awaiting_confirmation', 'booked', 'completed', 'declined', 'cancelled', 'no_show', 'not_interested', 'duplicate')),
  slot_at          timestamptz,
  vehicle          text check (vehicle ~ '^[A-Za-z0-9_ -]{1,40}$'),
  salesperson_id   uuid,
  salesperson_name text check (char_length(salesperson_name) <= 120),
  next_action      text check (next_action in ('send_proposal', 'follow_up_call', 'second_drive', 'customer_deciding', 'none')),
  source_alert_id  uuid references public.sales_alerts(id) on delete set null,
  requested_at     timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  closed_at        timestamptz,
  -- A booked drive carries its three facts (lifecycle.ts changeProblem).
  check (status <> 'booked' or (slot_at is not null and vehicle is not null and salesperson_id is not null))
);
-- One request in progress per chat; a customer who asks again after an outcome gets a new one.
create unique index if not exists test_drive_requests_one_open
  on public.test_drive_requests (conversation_id) where status in ('requested', 'contacted', 'awaiting_confirmation', 'booked');
create index if not exists test_drive_requests_status on public.test_drive_requests (status, updated_at desc);
alter table public.test_drive_requests enable row level security;

create table if not exists public.test_drive_request_events (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.test_drive_requests(id) on delete cascade,
  from_status text,
  to_status   text not null,
  by_staff    uuid,
  by_name     text check (char_length(by_name) <= 120),
  at          timestamptz not null default now()
);
create index if not exists test_drive_request_events_req on public.test_drive_request_events (request_id, at desc);
alter table public.test_drive_request_events enable row level security;

create table if not exists public.lead_assignment_rules (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null,
  staff_name text not null check (char_length(staff_name) between 1 and 120),
  brand      text check (brand in ('voyah', 'mhero', 'monza')),
  channel    text check (channel in ('whatsapp', 'instagram', 'facebook')),
  weight     integer not null default 1 check (weight between 1 and 10),
  active     boolean not null default true,
  set_by     uuid not null,
  set_name   text check (char_length(set_name) <= 120),
  set_at     timestamptz not null default now(),
  unique nulls not distinct (staff_id, brand, channel)
);
alter table public.lead_assignment_rules enable row level security;

-- Our own Instagram / Facebook replies, played back by Meta, are kept as turns (lib/channels/echoes.ts):
-- when we wrote, never what. A new source beside 'send' and 'meta_backfill'.
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.channel_turns'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%source%'
  loop
    execute format('alter table public.channel_turns drop constraint %I', c);
  end loop;
  alter table public.channel_turns add constraint channel_turns_source_check check (source in ('send', 'meta_backfill', 'echo'));
end $$;

-- Who spoke last, per chat that has an open alert. A PERSON's message only (author 'staff'), from
-- the stored WhatsApp messages and from the turns Meta's own history gave us — never the bot's.
create or replace function public.alert_chat_facts()
returns table (
  conversation_id  uuid,
  account_id       text,
  brand            text,
  channel          text,
  stored           boolean,
  owner_id         uuid,
  owner_name       text,
  last_customer_at timestamptz,
  last_person_at   timestamptz,
  waiting_since    timestamptz,
  ever_answered    boolean
)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  with convs as (
    select distinct s.conversation_ref::uuid as conv
      from public.sales_alerts s
     where s.status = 'open' and s.conversation_ref ~ '^[0-9a-f]{8}-[0-9a-f-]{27}$'
  ),
  ev as (
    select m.conversation_id as conv, m.sent_at as at,
           (m.direction = 'out' and m.author = 'staff') as person, (m.direction = 'in') as customer
      from public.channel_messages m join convs on convs.conv = m.conversation_id
    union all
    select t.conversation_id, t.at, (t.direction = 'out' and t.author = 'staff'), (t.direction = 'in')
      from public.channel_turns t join convs on convs.conv = t.conversation_id
  ),
  agg as (
    select c.id as conv, c.account_id, c.brand::text as brand, a.channel::text as channel,
           (a.channel::text = 'whatsapp') as stored, c.assigned_to, c.assigned_name,
           (select max(e.at) from ev e where e.conv = c.id and e.person) as last_person_at,
           greatest((select max(e.at) from ev e where e.conv = c.id and e.customer), c.last_inbound_at) as last_customer_at
      from public.channel_conversations c
      join public.channel_accounts a on a.id = c.account_id
      join convs on convs.conv = c.id
  )
  select g.conv, g.account_id, g.brand, g.channel, g.stored, g.assigned_to, g.assigned_name,
         g.last_customer_at, g.last_person_at,
         coalesce(
           (select min(e.at) from ev e where e.conv = g.conv and e.customer and e.at > coalesce(g.last_person_at, '-infinity'::timestamptz)),
           case when g.last_customer_at > coalesce(g.last_person_at, '-infinity'::timestamptz) then g.last_customer_at end
         ) as waiting_since,
         (g.last_person_at is not null) as ever_answered
    from agg g;
$$;
comment on function public.alert_chat_facts() is
  'Migration 033: per conversation with an open sales alert — who spoke last and when (a person''s message only, never the bot''s), the customer''s first unanswered message, the owner. Read by lib/alerts/reconcile-server.ts. Service role only.';
revoke all on function public.alert_chat_facts() from public, anon, authenticated;
grant execute on function public.alert_chat_facts() to service_role;
