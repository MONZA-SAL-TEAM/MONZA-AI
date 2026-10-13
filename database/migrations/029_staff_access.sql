-- 029 — Team & access: who may open which part of MONZA AI and do what, and who is online doing what
-- (Samer, 2026-10-13: "give roles to all the accounts … pages access and everything control and full tracking
-- to when online and what is doing"; MONZA AI only — the CRM's roles are untouched; only he is admin; pages +
-- actions, never which customer).
--
-- ADDITIVE ONLY. RLS on, no policies: only the server (service role) reads and writes.
--
--   staff_access      one row per staff member SOMEONE HAS SET. No row = MONZA AI as before (the CRM role decides).
--                     A row: is_admin (all of it, and this page), blocked (no MONZA AI at all), the pages and the
--                     actions allowed. Closed vocabularies, checked here.
--   staff_access_log  every change: who changed whose access, when, before and after (keys only).
--   staff_presence    one row per person: the section open now and when they were last seen / last active.
--   staff_events      what each person did, a line at a time: sign_in, page (a section opened), action (a button
--                     that changes something, by its name), refused (tried something not allowed). Never a
--                     customer, never a message, never a page address.

create table if not exists public.staff_access (
  user_id uuid primary key,
  name text check (name is null or char_length(name) <= 120),
  email text check (email is null or char_length(email) <= 200),
  is_admin boolean not null default false,
  blocked boolean not null default false,
  preset text check (preset is null or preset in ('full', 'manager', 'sales', 'viewer', 'custom')),
  pages text[] not null default '{}' check (pages <@ array['inbox','customers','insights','automations','installments','test_drives','sales','chat','dashboard','integrations','settings']::text[]),
  actions text[] not null default '{}' check (actions <@ array['send_messages','take_leads','assign_leads','close_alerts','edit_insights','manage_test_drives','edit_sales_library']::text[]),
  updated_by uuid,
  updated_by_name text check (updated_by_name is null or char_length(updated_by_name) <= 120),
  updated_at timestamptz not null default now()
);
alter table public.staff_access enable row level security;

create table if not exists public.staff_access_log (
  id bigserial primary key,
  user_id uuid not null,
  by_staff uuid,
  by_name text check (by_name is null or char_length(by_name) <= 120),
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);
create index if not exists staff_access_log_user on public.staff_access_log (user_id, at desc);
alter table public.staff_access_log enable row level security;

create table if not exists public.staff_presence (
  staff_id uuid primary key,
  staff_name text check (staff_name is null or char_length(staff_name) <= 120),
  section text check (section is null or section ~ '^[a-z_]{1,24}$'),
  device text check (device is null or device in ('phone', 'tablet', 'computer')),
  last_seen timestamptz not null default now(),
  last_active timestamptz,
  signed_in_at timestamptz
);
alter table public.staff_presence enable row level security;

create table if not exists public.staff_events (
  id bigserial primary key,
  staff_id uuid not null,
  staff_name text check (staff_name is null or char_length(staff_name) <= 120),
  at timestamptz not null default now(),
  kind text not null check (kind in ('sign_in', 'page', 'action', 'refused')),
  detail text check (detail is null or detail ~ '^[a-z0-9_]{1,40}$')
);
create index if not exists staff_events_staff on public.staff_events (staff_id, at desc);
create index if not exists staff_events_at on public.staff_events (at desc);
alter table public.staff_events enable row level security;
