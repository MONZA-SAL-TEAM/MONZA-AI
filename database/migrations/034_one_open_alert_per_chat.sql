-- =============================================================================
-- 034 — One open alert per chat, enforced by the database.
--
-- APPLY ONLY AFTER THE FIRST RECONCILIATION (033 + lib/alerts/reconcile-server.ts applyReconcile):
-- on 2026-11-25 there were 81 second alerts in 60 chats, and this index cannot be built over them.
-- Check first:   select conversation_ref, count(*) from sales_alerts where status = 'open'
--                group by 1 having count(*) > 1;      -- must return no row
--
-- From then on a second open alert in a chat is refused (23505), and recordAlert (sales-ops.ts)
-- merges the new reasons into the open one instead — the application already does this; the index
-- is what makes it impossible to get wrong again.
-- =============================================================================
create unique index if not exists sales_alerts_one_open_per_chat
  on public.sales_alerts (account_id, conversation_ref) where status = 'open';
