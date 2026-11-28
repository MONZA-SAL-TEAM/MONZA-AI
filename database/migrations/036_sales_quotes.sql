-- =============================================================================
-- 036 — What MONZA quoted, in numbers (Samer, 2026-11-28: "analyse both incoming customer messages
--       and outgoing MONZA responses … price communicated → …").
--
-- ONE new table. It changes no existing row.
--
-- sales_quotes: one row per WhatsApp message the TEAM sent that carried a price or payment terms —
-- the total, the down payment, the monthly installment, the months, the car and when. NEVER a word
-- of the message, never a customer's name or number. Read by lib/wasales/quote.ts, written by
-- lib/insights/quotes-server.ts (nightly, idempotent on the message id).
--
-- Why: an audit that day found the usual first answer carries total + down payment + monthly in one
-- message, and 78% of the people who received it wrote nothing after. "Who was offered what, and
-- then went quiet" is the list a new installment plan is for; it cannot be built unless the offer
-- is on record.
--
-- WhatsApp only: Instagram and Facebook words are never stored, so nothing can be read there.
-- Follows a conversation's deletion (cascade). RLS on, no policies: service role only.
-- =============================================================================

create table if not exists public.sales_quotes (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid not null references public.channel_conversations(id) on delete cascade,
  account_id          text not null,
  brand               text not null,
  external_message_id text not null check (char_length(external_message_id) <= 200),
  at                  timestamptz not null,
  kind                text not null check (kind in ('offer', 'price', 'terms')),
  -- The workbook's code for the car, or null when neither the message nor the conversation says.
  model               text check (model ~ '^[A-Z0-9_]{1,40}$'),
  -- message = the message names the car; conversation = the car being discussed just before it.
  model_binding       text check (model_binding in ('message', 'conversation')),
  total_min           integer check (total_min between 15000 and 500000),
  total_max           integer check (total_max between 15000 and 500000),
  down_payment        integer check (down_payment between 1000 and 300000),
  monthly             integer check (monthly between 100 and 20000),
  months              integer check (months between 6 and 120),
  currency            text not null default 'USD' check (currency = 'USD'),
  created_at          timestamptz not null default now(),
  constraint sales_quotes_message_uniq unique (account_id, external_message_id),
  constraint sales_quotes_account_fk foreign key (account_id, brand) references public.channel_accounts(id, brand) on delete cascade,
  constraint sales_quotes_has_amount check (total_min is not null or down_payment is not null or monthly is not null)
);
create index if not exists sales_quotes_conv_idx on public.sales_quotes (conversation_id, at);
create index if not exists sales_quotes_model_idx on public.sales_quotes (model, at);
alter table public.sales_quotes enable row level security;

comment on table public.sales_quotes is
  'Migration 036: the price and payment terms MONZA sent on WhatsApp, as numbers only (never the words). Service role only.';
