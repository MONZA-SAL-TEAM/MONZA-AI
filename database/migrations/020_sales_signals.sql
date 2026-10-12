-- =============================================================================
-- 020_sales_signals.sql — what the sales bot UNDERSTOOD from every customer message, kept for the
-- insights page (Samer, 2026-10-12: "track the data and save the data for insights about the models
-- and about our clients").
--
-- ADDITIVE ONLY: one new table, nothing changed or dropped.
--
-- One row per inbound customer message, on every channel. It holds the engine's reading — which car,
-- which question, which colour, which language, what a person was alerted about — and NEVER the words.
-- Instagram and Facebook words are not stored anywhere (Samer, 2026-09-10); this table keeps that rule:
-- the message is read in memory at the webhook and only its labels land here.
--
-- Idempotent on the platform's message id (rule 17): a redelivery updates the same row.
-- RLS ON, NO POLICIES: service role only, like every table here.
-- =============================================================================

create table if not exists public.sales_signals (
  id                   uuid primary key default gen_random_uuid(),
  account_id           text not null,
  brand                public.monza_brand not null,
  channel              text not null check (channel in ('whatsapp', 'instagram', 'facebook')),
  conversation_id      uuid not null references public.channel_conversations(id) on delete cascade,
  external_message_id  text not null check (char_length(external_message_id) <= 200),
  -- When the customer wrote (the payload's time, never the receiving clock).
  at                   timestamptz not null,
  language             text not null default 'unknown' check (language in ('en', 'ar', 'arabizi', 'fr', 'mixed', 'unknown')),
  -- The engine's labels. Intents are its closed vocabulary (lib/wasales/intent.ts), models its codes.
  intents              text[] not null default '{}' check (cardinality(intents) <= 24),
  models               text[] not null default '{}' check (cardinality(models) <= 8),
  weak_models          text[] not null default '{}' check (cardinality(weak_models) <= 8),
  -- The colour named, under the workbook's official name, or null.
  colour               text check (char_length(colour) <= 60),
  has_media            boolean not null default false,
  -- What Sales was told about, if anything: the alert's kind and every tag (alerts.ts).
  alert_kind           text check (char_length(alert_kind) <= 40),
  alert_tags           text[] not null default '{}' check (cardinality(alert_tags) <= 16),
  -- What the bot would answer with (SEND_BROCHURE, SEND_FACTS, …) and what it held back (silence.ts).
  offered              text[] not null default '{}' check (cardinality(offered) <= 16),
  silenced             text[] not null default '{}' check (cardinality(silenced) <= 16),
  created_at           timestamptz not null default now(),

  constraint sales_signals_message_uniq unique (account_id, external_message_id),
  constraint sales_signals_account_fk
    foreign key (account_id, brand)
    references public.channel_accounts(id, brand)
    on delete cascade
);

create index if not exists sales_signals_at_idx on public.sales_signals (at desc);
create index if not exists sales_signals_conversation_idx on public.sales_signals (conversation_id, at desc);
create index if not exists sales_signals_models_idx on public.sales_signals using gin (models);

alter table public.sales_signals enable row level security;
