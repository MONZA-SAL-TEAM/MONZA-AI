-- UNDO of the first "Apply" on Insights → Alerts and waiting (lib/alerts/reconcile-server.ts,
-- applyReconcile). Run ONLY on the owner's word. Rehearsed on 2026-11-26 against the live data
-- inside a transaction that was rolled back: 0 differences on what the run touched; an alert the live
-- system updated meanwhile kept its update.
--
-- Why a copy is needed: the event log keeps WHAT happened to an alert, but not the old kind / tags /
-- models / urgency of the alert a duplicate was merged into. So before the first Apply the open
-- alerts were copied to public.sales_alerts_before_apply_20261126 (migration
-- alerts_before_apply_copy_20261126). This script puts them back from that copy.
--
-- What it does, in ONE transaction (a DO block: any error keeps nothing):
--   1. every copied alert that is still open, or that an AUTOMATIC close shut after the copy, gets
--      its status, close and verdict fields back. An alert a PERSON closed since then is left alone.
--      Kind / tags / models / urgency go back ONLY on the alerts the run merged duplicates into;
--      on those, a reason a customer added between the run and the undo is lost (stated limit).
--   2. an alert raised AFTER the copy that the run closed as a duplicate, or into a test-drive
--      request, is opened again.
--   3. test-drive requests made from an alert and never touched since (one event only) are deleted;
--      one somebody has worked on is KEPT.
--   4. a 'restored' line in sales_alert_events for every alert it re-opened.
--   5. it checks itself: any copied alert not closed by a person must equal its copy, or it raises.
--
-- What it does NOT do: it does not undo owners set by an assignment rule (there were no rules on
-- 2026-11-26; it REFUSES to run if the run assigned anybody, so that is never silently skipped),
-- and it does not touch the alert's verdict of alerts raised after the copy.
do $undo$
declare
  reopened int; requests int; kept int; wrong int; assigned int;
begin
  select count(*) into assigned from public.conversation_owner_events e
   where e.by_name = 'Automatic (assignment rule)'
     and e.at >= (select min(copied_at) from public.sales_alerts_before_apply_20261126);
  if assigned > 0 then
    raise exception 'The run assigned % chat(s) by rule. This script does not undo owners: extend it first.', assigned;
  end if;

  create temp table _undo_target on commit drop as
    select a.id, a.status as was_status
      from public.sales_alerts a
      join public.sales_alerts_before_apply_20261126 c on c.id = a.id
     where a.status = 'open' or (a.closed_by like 'auto:%' and a.closed_at >= c.copied_at);

  -- Close and verdict fields: back to the copy.
  update public.sales_alerts a
     set status = c.status, closed_at = c.closed_at, closed_by = c.closed_by, close_reason = c.close_reason,
         superseded_by = c.superseded_by, verdict = c.verdict, verdict_at = c.verdict_at
    from public.sales_alerts_before_apply_20261126 c, _undo_target t
   where a.id = c.id and t.id = a.id;

  -- Kind / tags / models / urgency: ONLY on the alerts the run merged duplicates into (it logged
  -- 'merged' for each). Every other alert keeps what the live system has written since the copy —
  -- a customer who wrote again in the meantime must not lose that.
  create temp table _undo_merged on commit drop as
    select distinct e.alert_id as id from public.sales_alert_events e
     where e.action = 'merged' and e.reason = 'newer_alert_open'
       and e.at >= (select min(copied_at) from public.sales_alerts_before_apply_20261126);
  update public.sales_alerts a
     set kind = c.kind, tags = c.tags, models = c.models, urgency = c.urgency
    from public.sales_alerts_before_apply_20261126 c, _undo_target t
   where a.id = c.id and t.id = a.id and a.id in (select id from _undo_merged);

  create temp table _undo_later on commit drop as
    select a.id from public.sales_alerts a
     where a.status = 'done' and a.closed_by like 'auto:%' and a.close_reason in ('duplicate', 'handled')
       and a.created_at >= (select min(copied_at) from public.sales_alerts_before_apply_20261126)
       and not exists (select 1 from public.sales_alerts_before_apply_20261126 c where c.id = a.id);
  update public.sales_alerts a
     set status = 'open', closed_at = null, closed_by = null, close_reason = null, superseded_by = null
   where a.id in (select id from _undo_later);

  insert into public.sales_alert_events (alert_id, action, reason, by_name)
    select id, 'restored', 'apply_undone', 'Undo of the first Apply' from _undo_target where was_status <> 'open'
    union all
    select id, 'restored', 'apply_undone', 'Undo of the first Apply' from _undo_later;
  get diagnostics reopened = row_count;

  select count(*) into kept from public.test_drive_requests r
   where r.source_alert_id is not null
     and (select count(*) from public.test_drive_request_events e where e.request_id = r.id) > 1;
  delete from public.test_drive_requests r
   where r.source_alert_id is not null
     and (select count(*) from public.test_drive_request_events e where e.request_id = r.id) <= 1;
  get diagnostics requests = row_count;

  select count(*) into wrong
    from public.sales_alerts a join public.sales_alerts_before_apply_20261126 c on c.id = a.id
   where not (a.status = 'done' and a.closed_by is not null and a.closed_by not like 'auto:%')
     and ((a.status, a.closed_at, a.closed_by, a.close_reason, a.superseded_by, a.verdict, a.verdict_at)
           is distinct from
           (c.status, c.closed_at, c.closed_by, c.close_reason, c.superseded_by, c.verdict, c.verdict_at)
          or (a.id in (select id from _undo_merged)
              and (a.kind, a.tags, a.models, a.urgency) is distinct from (c.kind, c.tags, c.models, c.urgency)));
  if wrong > 0 then
    raise exception 'Undo check failed: % alert(s) differ from the copy. Nothing was changed.', wrong;
  end if;

  raise notice 'Undo done: % alert(s) re-opened, % test-drive request(s) removed, % kept because somebody worked on them.', reopened, requests, kept;
end
$undo$;
