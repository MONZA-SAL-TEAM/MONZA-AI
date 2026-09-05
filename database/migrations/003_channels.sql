-- =============================================================================
-- 003_channels.sql — the unified inbox's own storage.
--
-- Conversations with customers over Instagram, Messenger and WhatsApp. These
-- are MONZA AI's OWN records — unlike customers, vehicles and installments,
-- which are read from the source systems and never owned here.
--
-- NOT to be confused with public.conversations / public.messages from
-- 000_core.sql: those are the staff assistant's chat with the AI. Different
-- thing, different lifetime, different owner. Hence the channel_ prefix.
--
-- Everything is written by the server with the service role. RLS is on and
-- closed: no policy exists, so the anon key reads nothing.
-- =============================================================================

-- ── Brands ──────────────────────────────────────────────────────────────────
--
-- Monza sells three marques through three SEPARATE Meta business portfolios.
-- A VOYAH conversation must never be able to resolve to an MHERO channel
-- merely because both are Monza. That rule is enforced structurally below, not
-- by convention — see the composite foreign keys.

create type public.monza_brand as enum ('voyah', 'mhero', 'monza');

create type public.channel_kind as enum ('whatsapp', 'instagram', 'facebook');

-- ── Connected accounts ──────────────────────────────────────────────────────
--
-- One row per Instagram profile / Facebook Page / WhatsApp number. There is a
-- LIST rather than one per channel because Monza runs three Instagram accounts
-- and three Pages, and a token issued in one portfolio cannot see another's
-- assets however it is scoped.
--
-- NO TOKEN IS STORED HERE. `token_env` is the NAME of the server environment
-- variable holding it. A database that cannot leak a token is worth more than
-- one that encrypts one.

create table if not exists public.channel_accounts (
  id            text primary key,          -- ours: 'ig-voyah'
  brand         public.monza_brand not null,
  channel       public.channel_kind not null,
  display_name  text not null,             -- '@voyahlebanon'
  -- What Meta calls it, and what inbound webhooks address: the IG user id, the
  -- Page id, or the WhatsApp phone NUMBER id.
  external_id   text not null,
  -- Which Meta business portfolio owns it. Recorded because it is the answer
  -- to "why does this token not work", the most expensive question here.
  portfolio     text not null,
  token_env     text not null,
  connected_at  timestamptz,               -- null until proven end to end
  created_at    timestamptz not null default now(),

  -- One account per external id per channel: two rows claiming the same
  -- Instagram account would make routing ambiguous.
  unique (channel, external_id)
);

-- THE KEY TO BRAND ISOLATION. Redundant on its own (id is already unique), but
-- it lets a child table carry brand and point a composite FK at (id, brand),
-- which makes a mismatched pair unrepresentable rather than merely discouraged.
alter table public.channel_accounts
  add constraint channel_accounts_id_brand_key unique (id, brand);

-- ── Conversations ───────────────────────────────────────────────────────────
--
-- One thread with one person on one channel.
--
-- A person may have several: a WhatsApp thread and an Instagram thread are
-- genuinely separate places, and pretending otherwise loses replies. They are
-- joined by customer_id — an OPAQUE reference to the CRM, never a foreign key,
-- because MONZA AI does not own customers.

create table if not exists public.channel_conversations (
  id                uuid primary key default gen_random_uuid(),
  account_id        text not null,
  -- Denormalised so the composite FK below can enforce it. It is not a second
  -- source of truth: the constraint makes disagreement impossible.
  brand             public.monza_brand not null,
  -- The other party's opaque id on that channel. With account_id it is the
  -- natural key for "the thread with this person here".
  peer_external_id  text not null,
  -- Their handle or number, for display only. Usernames change; ids do not.
  peer_display      text,
  -- The CRM customer, once somebody links them. Null is the normal state:
  -- Instagram gives no phone number, so most threads start unidentified.
  customer_id       text,
  status            text not null default 'open'
                    check (status in ('open','waiting_reply','follow_up','closed')),
  assigned_to       uuid,
  -- When the customer last wrote. THE 24-HOUR WINDOW IS COMPUTED FROM THIS,
  -- so it is a column rather than a lookup over messages: the inbox reads it
  -- on every row it lists.
  last_inbound_at   timestamptz,
  last_message_at   timestamptz,
  unread_count      integer not null default 0 check (unread_count >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint channel_conversations_account_fk
    foreign key (account_id) references public.channel_accounts(id),

  -- ── Brand isolation, structurally ────────────────────────────────────────
  -- A conversation's brand MUST be its account's brand. Writing a VOYAH
  -- conversation against an MHERO account is a constraint violation, not a
  -- code-review finding.
  constraint channel_conversations_brand_fk
    foreign key (account_id, brand)
    references public.channel_accounts(id, brand),

  -- One thread per person per account.
  unique (account_id, peer_external_id)
);

alter table public.channel_conversations
  add constraint channel_conversations_id_brand_key unique (id, brand);

create index if not exists channel_conversations_inbox_idx
  on public.channel_conversations (brand, status, last_message_at desc);
create index if not exists channel_conversations_customer_idx
  on public.channel_conversations (customer_id)
  where customer_id is not null;

-- ── Messages ────────────────────────────────────────────────────────────────

create table if not exists public.channel_messages (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid not null,
  brand               public.monza_brand not null,
  -- Carried on every message, not only on the conversation, so a query that
  -- forgets to join still cannot mix brands.
  account_id          text not null,
  direction           text not null check (direction in ('in','out')),
  author              text not null check (author in ('customer','staff','automation')),
  body                text not null default '',
  attachments         jsonb not null default '[]'::jsonb,

  -- ── IDEMPOTENCY ──────────────────────────────────────────────────────────
  -- The platform's own message id. Meta REDELIVERS: a delivery that fails, or
  -- times out, or that we answer slowly, comes again — for up to seven days.
  -- Without this constraint the customer sees duplicate threads and staff
  -- answer the same message twice.
  --
  -- Unique per ACCOUNT, not globally: ids are only unique within a platform,
  -- and nothing says two platforms cannot mint the same string.
  --
  -- Nullable because an outbound message has no platform id until it is sent,
  -- and Postgres lets nulls repeat under a unique constraint — which is the
  -- behaviour wanted here.
  external_message_id text,

  status              text not null default 'received'
                      check (status in ('received','queued','sent','delivered','read','failed')),
  -- Why a send failed, for staff. Never a raw provider dump.
  error               text,
  staff_id            uuid,
  staff_name          text,
  automation_id       text,
  -- FROM THE PAYLOAD, never the receiving clock: a message redelivered three
  -- days late must sit at the time it was sent, or the thread reads wrong.
  sent_at             timestamptz not null,
  created_at          timestamptz not null default now(),

  constraint channel_messages_conversation_fk
    foreign key (conversation_id) references public.channel_conversations(id)
    on delete cascade,

  -- Same structural rule as above: a message cannot belong to a conversation
  -- of a different brand.
  constraint channel_messages_brand_fk
    foreign key (conversation_id, brand)
    references public.channel_conversations(id, brand),

  constraint channel_messages_account_brand_fk
    foreign key (account_id, brand)
    references public.channel_accounts(id, brand),

  unique (account_id, external_message_id)
);

create index if not exists channel_messages_thread_idx
  on public.channel_messages (conversation_id, sent_at);

-- ── Raw deliveries ──────────────────────────────────────────────────────────
--
-- Every VERIFIED webhook body, kept briefly.
--
-- Not for the product — for the day a message does not appear and the question
-- is whether Meta sent it. Written only after the signature passes, so this is
-- never a store of unauthenticated input.

create table if not exists public.channel_deliveries (
  id           uuid primary key default gen_random_uuid(),
  channel      public.channel_kind,
  payload      jsonb not null,
  event_count  integer not null default 0,
  stored_count integer not null default 0,
  received_at  timestamptz not null default now()
);

create index if not exists channel_deliveries_time_idx
  on public.channel_deliveries (received_at desc);

-- ── RLS: on, and closed ─────────────────────────────────────────────────────
--
-- No policies. The server reads and writes with the service role; the anon key
-- that ships in the browser bundle can reach none of this. Customer
-- conversations are the most sensitive data this product holds.

alter table public.channel_accounts      enable row level security;
alter table public.channel_conversations enable row level security;
alter table public.channel_messages      enable row level security;
alter table public.channel_deliveries    enable row level security;

-- ── Advancing a thread after a NEW inbound message ──────────────────────────
--
-- A function rather than an update from the application, for two reasons:
-- read-modify-write of unread_count would race between concurrent deliveries,
-- and the 24-hour window must never move backwards when Meta redelivers an
-- older message out of order.
--
-- Called ONLY when the message insert actually inserted. Calling it before
-- checking would let a redelivery inflate the unread badge on every retry.

create or replace function public.channel_note_inbound(
  p_conversation uuid,
  p_at timestamptz
) returns void
language sql
security definer
set search_path = public
as $$
  update public.channel_conversations
     set unread_count    = unread_count + 1,
         -- greatest() so an out-of-order redelivery of an OLDER message
         -- cannot rewind the reply window or the thread's position.
         last_inbound_at = greatest(coalesce(last_inbound_at, p_at), p_at),
         last_message_at = greatest(coalesce(last_message_at, p_at), p_at),
         -- The customer wrote, so it needs an answer — including when the
         -- thread had been closed.
         status          = 'open',
         updated_at      = now()
   where id = p_conversation;
$$;

revoke all on function public.channel_note_inbound(uuid, timestamptz)
  from public, anon, authenticated;
