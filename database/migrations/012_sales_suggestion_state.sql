-- =============================================================================
-- 012_sales_suggestion_state.sql — what the sales Search Engine remembers about
-- ONE chat, so its next suggestion follows on from the last one a person sent.
--
-- The inbox shows the engine's suggested reply (brochure, colour video, facts,
-- choices) and a PERSON presses Send (Samer, 2026-09-15: "suggest only, never
-- automatic"). When they do, the engine's next state and the message ids Meta
-- returned are saved here:
--
--   state             lib/wasales/context.ts SearchEngineState — which model,
--                     which colour, what the customer asked before choosing,
--                     what we are waiting for. Validated by parseState() on
--                     every read.
--   sent_message_ids  Meta's ids of the messages sent from suggestions. Any
--                     OTHER outgoing message in the chat was written by a
--                     person, and suggestions stop for that chat.
--   resumed_at        "Suggest again": replies a person wrote before this are
--                     forgiven.
--   started_at        where the chat the engine sees BEGINS (the autoreply
--                     pilot's first answer); everything at or before it is
--                     ignored, so old tests and replies are not part of it.
--   rev               bumped on every save; a send that read an older row is
--                     refused, so two people pressing at once send once.
--
-- NEVER the customer's words, and never ours: Instagram and Facebook text is
-- read live from Meta and kept nowhere (Samer, 2026-09-10).
--
-- Keyed by the ACCOUNT and the conversation's reference on it — the Meta
-- conversation id for Instagram and Facebook, our channel_conversations id for
-- WhatsApp — because an Instagram chat can exist here with no
-- channel_conversations row at all. The composite foreign key to
-- channel_accounts(id, brand) keeps a state from hanging off another brand's
-- account (rule 4).
--
-- Replaces the unapplied 008_conversation_sales_state.sql (the automatic design
-- Samer did not choose). 009-011 are taken (WhatsApp messages, WhatsApp
-- media, sent files).
-- =============================================================================

create table if not exists public.sales_suggestion_state (
  account_id        text not null,
  conversation_ref  text not null check (conversation_ref ~ '^[A-Za-z0-9_.:=-]{1,200}$'),
  brand             public.monza_brand not null,
  state             jsonb not null,
  sent_message_ids  text[] not null default '{}',
  resumed_at        timestamptz,
  started_at        timestamptz,
  rev               integer not null default 1 check (rev >= 1),
  updated_at        timestamptz not null default now(),

  primary key (account_id, conversation_ref),

  constraint sales_suggestion_state_account_fk
    foreign key (account_id, brand)
    references public.channel_accounts(id, brand)
    on delete cascade,

  -- The shape parseState() reads; another version is refused, not half-read.
  constraint sales_suggestion_state_version
    check (jsonb_typeof(state) = 'object' and state ->> 'version' = '1'),

  -- A few hundred bytes in practice. Anything near these is a bug.
  constraint sales_suggestion_state_size
    check (pg_column_size(state) < 8192),
  constraint sales_suggestion_state_ids
    check (cardinality(sent_message_ids) <= 500)
);

-- ── RLS: on, and closed ─────────────────────────────────────────────────────
-- Same model as 003: no policies. The server reads and writes with the service
-- role; the anon key in the browser bundle can reach none of this.

alter table public.sales_suggestion_state enable row level security;
