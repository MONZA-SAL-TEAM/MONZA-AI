-- =============================================================================
-- 008_conversation_sales_state.sql — the Search Engine's memory of ONE
-- conversation, and nothing else.
--
-- The Customer Search & Media Engine (lib/wasales/engine.ts) is pure: it takes
-- a conversation's SearchEngineState and returns the next one. This table is
-- where a webhook handler would keep it between messages — which model is
-- being discussed, which colour, the questions asked before the model was
-- known, what the engine is waiting for. lib/wasales/context.ts parseState()
-- validates every field on the way back in, so a stale or hand-edited row can
-- never put the engine somewhere it cannot reason about.
--
-- DELIBERATELY NARROW. Not a CRM, not a lead, not a copy of the messages: one
-- small JSON document per conversation, deleted with the conversation. The
-- customer's words are never stored here.
--
-- NOT APPLIED. Nothing calls the engine from the webhook yet (CLAUDE.md rule
-- 24). Apply it when automated replies are switched on, not before.
--
-- Numbering: 004 is taken by the car-care work and 007 by the privacy work,
-- both still on other branches.
-- =============================================================================

create table if not exists public.conversation_sales_state (
  conversation_id  uuid primary key,
  -- Denormalised so the composite FK below can enforce it, exactly as
  -- channel_messages does: a VOYAH state cannot hang off an MHERO thread.
  brand            public.monza_brand not null,
  state            jsonb not null,
  updated_at       timestamptz not null default now(),

  constraint conversation_sales_state_conversation_fk
    foreign key (conversation_id, brand)
    references public.channel_conversations(id, brand)
    on delete cascade,

  -- The shape parseState() reads. A different version is refused rather
  -- than half-read.
  constraint conversation_sales_state_version
    check (jsonb_typeof(state) = 'object' and state ->> 'version' = '1'),

  -- A few hundred bytes in practice. Anything near this is a bug, not a
  -- conversation.
  constraint conversation_sales_state_size
    check (pg_column_size(state) < 8192)
);

-- ── RLS: on, and closed ─────────────────────────────────────────────────────
--
-- Same model as 003: no policies. The server reads and writes with the service
-- role; the anon key in the browser bundle can reach none of this.

alter table public.conversation_sales_state enable row level security;
