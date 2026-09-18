-- =============================================================================
-- 017_sales_alert_lead.sql — "follow up the lead" (Samer's workbook, 2026-09-18:
-- "when done and have received the brochure and the video notify sales to
-- follow up on the lead"). One more alert kind; nothing else changes.
-- =============================================================================

alter table public.sales_alerts drop constraint if exists sales_alerts_kind_check;
alter table public.sales_alerts
  add constraint sales_alerts_kind_check
  check (kind in ('PRICE', 'FINANCING', 'TEST_DRIVE', 'STOCK', 'DISCOUNT', 'TRADE_IN', 'NEEDS_PERSON', 'CALLBACK', 'HUMAN', 'QUESTION', 'LEAD'));
