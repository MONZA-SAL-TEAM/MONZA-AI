-- =============================================================================
-- 013_sales_alerts.sql — "alert the sales team to call this client"
-- (Samer's workbook, C Decisions and E Master Bot Logic, 2026-09-17).
--
-- The sales bot never states a price, an offer, stock or payment terms. When a
-- customer asks for one, or leaves their name for installments or a test drive,
-- the bot tells them the team will contact them and records an alert here. The
-- inbox shows the open alerts ("Call this client"), and a WhatsApp message goes
-- to the salesperson's own phone when that is configured.
--
--   kind            PRICE · FINANCING · TEST_DRIVE · STOCK · DISCOUNT · TRADE_IN
--   models          the engine's model codes the customer asked about
--   customer_name   the name the customer typed when the bot asked for it
--   customer_phone  digits only: the WhatsApp number, or a number typed on
--                   Instagram / Messenger
--   slot_at         the booked test-drive time, for a booking alert
--
-- Customer name and number are personal data, kept for the follow-up. The daily
-- clean-up removes alerts after 12 months, like WhatsApp messages (009).
-- =============================================================================

create table if not exists public.sales_alerts (
  id                uuid primary key default gen_random_uuid(),
  account_id        text not null,
  brand             public.monza_brand not null,
  conversation_ref  text not null check (conversation_ref ~ '^[A-Za-z0-9_.:=-]{1,200}$'),
  thread_id         text not null check (char_length(thread_id) <= 400),
  kind              text not null check (kind in ('PRICE', 'FINANCING', 'TEST_DRIVE', 'STOCK', 'DISCOUNT', 'TRADE_IN')),
  models            text[] not null default '{}' check (cardinality(models) <= 8),
  customer_name     text check (char_length(customer_name) between 1 and 120),
  customer_phone    text check (customer_phone ~ '^[0-9]{7,15}$'),
  slot_at           timestamptz,
  status            text not null default 'open' check (status in ('open', 'done')),
  staff_notified    boolean not null default false,
  created_at        timestamptz not null default now(),
  closed_at         timestamptz,
  closed_by         text check (char_length(closed_by) <= 120),

  constraint sales_alerts_account_fk
    foreign key (account_id, brand)
    references public.channel_accounts(id, brand)
    on delete cascade
);

create index if not exists sales_alerts_open on public.sales_alerts (status, created_at desc);
create index if not exists sales_alerts_thread on public.sales_alerts (account_id, conversation_ref, created_at desc);

-- RLS on, no policies: the server reads and writes with the service role only.
alter table public.sales_alerts enable row level security;
