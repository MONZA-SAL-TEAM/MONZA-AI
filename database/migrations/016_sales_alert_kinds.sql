-- =============================================================================
-- 016_sales_alert_kinds.sql — more reasons a customer needs a person
-- (Samer, 2026-09-17): a call-back request, an explicit "can I talk to a human",
-- and a question the bot has no approved answer for (delivery, paying in LBP,
-- used cars, an unsupported specification).
-- =============================================================================

alter table public.sales_alerts drop constraint if exists sales_alerts_kind_check;
alter table public.sales_alerts
  add constraint sales_alerts_kind_check
  check (kind in ('PRICE', 'FINANCING', 'TEST_DRIVE', 'STOCK', 'DISCOUNT', 'TRADE_IN', 'NEEDS_PERSON', 'CALLBACK', 'HUMAN', 'QUESTION'));
