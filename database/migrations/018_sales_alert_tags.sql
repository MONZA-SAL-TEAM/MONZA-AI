-- =============================================================================
-- 018_sales_alert_tags.sql — ONE actionable alert per customer (Samer's audit, 2026-09-18).
--
-- Until now every topic in a message raised its own alert: "I want the Courage, do you have stock,
-- can I finance it and test drive tomorrow?" put four rows on the inbox. An alert now carries every
-- reason as a TAG, with the most important as its kind, and how soon a person should act.
--
-- ADDITIVE ONLY: two new columns with defaults and three new kinds. Nothing is dropped, renamed or
-- rewritten; rows written before this migration read as one-tag, normal-urgency alerts.
--
--   tags     everything the alert is about, most important first (kind = tags[1])
--   urgency  normal · qualified (a commercial enquiry) · hot (wants to buy / reserve) · overdue (kept waiting)
--   kinds    + BUYING ("I'll take it", "reserve one"), OVERDUE ("I've been waiting since yesterday"),
--            VISIT ("can I pass by tomorrow?")
-- =============================================================================

alter table public.sales_alerts add column if not exists tags text[] not null default '{}';
alter table public.sales_alerts add column if not exists urgency text not null default 'normal';

alter table public.sales_alerts drop constraint if exists sales_alerts_urgency_check;
alter table public.sales_alerts
  add constraint sales_alerts_urgency_check check (urgency in ('normal', 'qualified', 'hot', 'overdue'));

alter table public.sales_alerts drop constraint if exists sales_alerts_kind_check;
alter table public.sales_alerts
  add constraint sales_alerts_kind_check
  check (kind in ('PRICE', 'FINANCING', 'TEST_DRIVE', 'STOCK', 'DISCOUNT', 'TRADE_IN', 'NEEDS_PERSON', 'CALLBACK', 'HUMAN', 'QUESTION', 'LEAD', 'BUYING', 'OVERDUE', 'VISIT'));
