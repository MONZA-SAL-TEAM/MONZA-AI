-- =============================================================================
-- 015_sales_alerts_needs_person.sql — mark the clients a PERSON must answer
-- (Samer, 2026-09-17: "send a notification through MONZA AI and mark the clients
-- that need human response for our sales to answer them").
--
-- The sales bot now also raises an alert when it cannot answer by itself: a photo
-- or story reply, a message it does not recognise, a complaint, or a reply it may
-- not send. The inbox marks those chats "Needs a person" and notifies staff.
--
--   kind   gains NEEDS_PERSON
--   reason why a person is needed, in the engine's words — never the customer's
-- =============================================================================

alter table public.sales_alerts drop constraint if exists sales_alerts_kind_check;
alter table public.sales_alerts
  add constraint sales_alerts_kind_check
  check (kind in ('PRICE', 'FINANCING', 'TEST_DRIVE', 'STOCK', 'DISCOUNT', 'TRADE_IN', 'NEEDS_PERSON'));

alter table public.sales_alerts
  add column if not exists reason text check (char_length(reason) <= 300);
