-- =============================================================================
-- 002_communication.sql — the communication layer MONZA AI OWNS.
--
-- NOT YET APPLIED. This file states the ownership boundary in schema so it can
-- be reviewed before anything is created; the product runs entirely on the demo
-- adapter until the channels are connected.
--
-- THE BOUNDARY, restated here because a schema is where it is easiest to break:
--
--   MONZA AI owns          conversations, messages, channel identities, message
--                          status, assignment, templates, automations,
--                          automation runs, notification history.
--
--   MONZA AI never owns    customers, vehicles, installments, payments,
--                          garage work orders, accounting. Those live in the
--                          source systems and are READ through the adapter
--                          (lib/domain) at question time.
--
-- Every table below therefore stores an OPAQUE REFERENCE to the source system's
-- id (source_customer_id, source_installment_id, source_vehicle_id) and never a
-- copy of the thing itself. There is no customers table here, and adding one —
-- even "just for names" — is how a communication layer becomes a second CRM
-- that disagrees with the first.
-- =============================================================================

-- ── Channels ────────────────────────────────────────────────────────────────
-- One row per way we can reach one person. The person themselves lives in the
-- source system; this is only their address on a channel.
create table if not exists public.channel_identities (
  id                 uuid primary key default gen_random_uuid(),
  channel            text not null check (channel in ('whatsapp','instagram','facebook')),
  -- Phone digits for WhatsApp, an account handle for Instagram/Facebook.
  address            text not null,
  -- The source system's customer id. Opaque here, deliberately: no foreign key
  -- can exist across systems, and none should.
  source_customer_id text,
  display_name       text,
  created_at         timestamptz not null default now(),
  unique (channel, address)
);
create index if not exists channel_identities_customer_idx
  on public.channel_identities (source_customer_id);

-- ── Conversations ───────────────────────────────────────────────────────────
-- A thread with one person on one channel. Two channels are two conversations,
-- because they genuinely are two places; the customer view joins them by
-- source_customer_id.
create table if not exists public.inbox_conversations (
  id                  uuid primary key default gen_random_uuid(),
  channel_identity_id uuid not null references public.channel_identities(id) on delete cascade,
  source_customer_id  text,
  status              text not null default 'open'
                        check (status in ('open','waiting_reply','follow_up','closed')),
  -- CRM auth.users id of the staff member who owns it, or null = unassigned.
  assigned_to         uuid,
  unread_count        integer not null default 0,
  last_message_at     timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists inbox_conversations_recent_idx
  on public.inbox_conversations (last_message_at desc);
create index if not exists inbox_conversations_assigned_idx
  on public.inbox_conversations (assigned_to, status);

-- ── Messages ────────────────────────────────────────────────────────────────
create table if not exists public.inbox_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.inbox_conversations(id) on delete cascade,
  direction       text not null check (direction in ('in','out')),
  author          text not null check (author in ('customer','staff','automation')),
  body            text not null,
  status          text not null default 'queued'
                    check (status in ('received','queued','sent','delivered','read','failed')),
  -- Which automation produced it, when one did. Never free text from a model:
  -- an automation may only send a known template.
  automation_id   text,
  -- The staff member who sent it, when a person did.
  staff_user_id   uuid,
  -- The channel provider's own id, so a delivery receipt can find its message.
  provider_message_id text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  unique (provider_message_id)
);
create index if not exists inbox_messages_thread_idx
  on public.inbox_messages (conversation_id, created_at);

-- ── Automations ─────────────────────────────────────────────────────────────
-- The catalog is code (lib/automations/catalog.ts); this table holds only what
-- an operator changes: whether each one is switched on.
create table if not exists public.automation_settings (
  automation_id text primary key,
  enabled       boolean not null default false,
  updated_by    uuid,
  updated_at    timestamptz not null default now()
);

-- Every attempt an automation made — sent, failed or skipped.
--
-- THE UNIQUE CONSTRAINT ON idempotency_key IS THE DUPLICATE DEFENCE. The key is
-- derived from the automation, the occurrence and the action index
-- (lib/automations/engine.ts), never from a clock, so re-processing the same
-- event cannot insert a second row — and therefore cannot send a second
-- message. Attempts of the SAME key are distinguished by attempt_number.
create table if not exists public.automation_runs (
  id                 uuid primary key default gen_random_uuid(),
  idempotency_key    text not null,
  attempt_number     integer not null default 1,
  automation_id      text not null,
  event_id           text not null,
  source_customer_id text,
  action_kind        text not null check (action_kind in ('send_message','notify_staff','create_followup')),
  outcome            text not null check (outcome in ('sent','failed','skipped')),
  detail             text,
  conversation_id    uuid references public.inbox_conversations(id) on delete set null,
  created_at         timestamptz not null default now(),
  unique (idempotency_key, attempt_number)
);
create index if not exists automation_runs_key_idx
  on public.automation_runs (idempotency_key);
create index if not exists automation_runs_recent_idx
  on public.automation_runs (automation_id, created_at desc);

-- ── Closed by default ───────────────────────────────────────────────────────
-- The app's server routes use the service role; nothing else can read anything.
alter table public.channel_identities   enable row level security;
alter table public.inbox_conversations  enable row level security;
alter table public.inbox_messages       enable row level security;
alter table public.automation_settings  enable row level security;
alter table public.automation_runs      enable row level security;
