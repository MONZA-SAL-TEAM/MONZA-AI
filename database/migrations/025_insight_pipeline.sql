-- =============================================================================
-- 025_insight_pipeline.sql — the Connections & Data Pipeline Health panel's counts, per account, in ONE
-- query (Samer, 2026-10-12: "Never convert database errors or API failures into a displayed zero").
--
-- ADDITIVE ONLY: one read-only function. Counts and timestamps only — never a message, never a name.
--   unlabelled_since_rebuild  customer messages stored AFTER the last finished history read with no label:
--                             waiting, or failed at the webhook.
--   unlabelled_before         stored before it with no label: the engine excluded them (scams, vendors,
--                             empty or test messages) — counted apart, never called "pending".
-- Samer's pilot test phones are passed in and left out (they are never clients).
-- Service role only.
-- =============================================================================

create or replace function public.insight_pipeline_counts(p_test_peers text[])
returns table (
  account_id text,
  conversations bigint,
  customer_messages bigint,
  our_messages bigint,
  last_customer_message timestamptz,
  last_our_message timestamptz,
  labelled bigint,
  last_labelled timestamptz,
  facts bigint,
  unlabelled_since_rebuild bigint,
  unlabelled_before bigint,
  test_messages bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with rebuilt as (
    select coalesce((select finished_at from insight_backfill_runs where id = 'wa:rebuild' and state = 'done'), 'epoch'::timestamptz) as at
  ),
  inbound as (
    select m.account_id, m.external_message_id, m.created_at, (c.peer_external_id = any(coalesce(p_test_peers, '{}'))) as test
    from channel_messages m join channel_conversations c on c.id = m.conversation_id
    where m.direction = 'in'
  )
  select
    a.id,
    (select count(*) from channel_conversations c where c.account_id = a.id),
    (select count(*) from inbound i where i.account_id = a.id and not i.test),
    (select count(*) from channel_messages m where m.account_id = a.id and m.direction = 'out')
      + (select count(*) from channel_turns t where t.account_id = a.id and t.direction = 'out'),
    (select max(m.sent_at) from channel_messages m where m.account_id = a.id and m.direction = 'in'),
    greatest((select max(m.sent_at) from channel_messages m where m.account_id = a.id and m.direction = 'out'),
             (select max(t.at) from channel_turns t where t.account_id = a.id and t.direction = 'out')),
    (select count(*) from sales_signals s where s.account_id = a.id),
    (select max(s.created_at) from sales_signals s where s.account_id = a.id),
    (select count(*) from sales_observations o where o.account_id = a.id),
    (select count(*) from inbound i, rebuilt r where i.account_id = a.id and not i.test and i.created_at > r.at
       and not exists (select 1 from sales_signals s where s.account_id = i.account_id and s.external_message_id = i.external_message_id)),
    (select count(*) from inbound i, rebuilt r where i.account_id = a.id and not i.test and i.created_at <= r.at
       and not exists (select 1 from sales_signals s where s.account_id = i.account_id and s.external_message_id = i.external_message_id)),
    (select count(*) from inbound i where i.account_id = a.id and i.test)
  from channel_accounts a;
$$;

revoke all on function public.insight_pipeline_counts(text[]) from public, anon, authenticated;
grant execute on function public.insight_pipeline_counts(text[]) to service_role;
