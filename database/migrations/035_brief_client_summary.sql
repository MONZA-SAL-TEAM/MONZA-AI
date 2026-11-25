-- =============================================================================
-- 035 — The clients, counted, for the Monza app's Morning Briefing (Samer, 2026-11-25: "I don't
--       want to know deep details of the messaging system; instead I want the overview telling me
--       insights about all the clients").
--
-- ONE read-only function. It adds no table and changes no row.
--
-- brief_client_summary(p_exclude) answers, from the labels this product already keeps
-- (sales_signals) and from WHEN each side wrote (channel_messages) — never a word, a name, a
-- number or a chat id:
--   people        who wrote in the last 30 days, and in the 30 before
--   newPeople / returning
--   fromAd        people whose first touch was an ad, now and before
--   byChannel, byBrand
--   cars          the cars they named or were plainly talking about, by people
--   questions     the buying questions they asked, by people
--   people90d, buyingQuestion90d    for the closing-rate estimate (sales are the CRM's to count)
--   reply         WhatsApp only: customer messages that needed an answer in the last 30 days (those
--                 under a day old are left out — they may still be answered), how many a PERSON
--                 answered (never the bot), the median minutes, within the hour, never
--
-- p_exclude: the pilot's test phones (lib/wasales/autoreply-pilot.ts) — they are never clients.
-- On 2026-11-25 it read: 348 people against 817, 28 from an ad against 277.
-- =============================================================================

create or replace function public.brief_client_summary(p_exclude text[] default '{}')
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  with t as (select now() as n),
  sig as (
    select s.conversation_id, s.at, s.channel::text as channel, s.brand::text as brand,
           s.intents, s.models, s.context_models, s.ad_model
      from public.sales_signals s
      join public.channel_conversations c on c.id = s.conversation_id
     where s.at > (select n from t) - interval '90 days'
       and not (c.peer_external_id = any (p_exclude))
  ),
  cur as (select * from sig where at > (select n from t) - interval '30 days'),
  prev as (
    select * from sig
     where at <= (select n from t) - interval '30 days' and at > (select n from t) - interval '60 days'
  ),
  firsts as (select conversation_id, min(at) as first_at from public.sales_signals group by 1),
  m as (
    select m.conversation_id as c, m.sent_at as at, m.direction as d, m.author as a,
           lag(m.direction) over (partition by m.conversation_id order by m.sent_at) as prev_d
      from public.channel_messages m
      join public.channel_conversations cv on cv.id = m.conversation_id
      join public.channel_accounts acc on acc.id = cv.account_id
     where acc.channel::text = 'whatsapp'
       and m.sent_at > (select n from t) - interval '30 days'
       and not (cv.peer_external_id = any (p_exclude))
  ),
  bursts as (
    select c, at from m
     where d = 'in' and (prev_d is null or prev_d = 'out') and at < (select n from t) - interval '24 hours'
  ),
  r as (
    select b.at,
           (select min(x.at) from m x where x.c = b.c and x.d = 'out' and x.a = 'staff' and x.at > b.at) as replied
      from bursts b
  ),
  rt as (select extract(epoch from replied - at) / 60 as mins, replied from r)
  select jsonb_build_object(
    'at', (select n from t),
    'people', jsonb_build_object(
      'now', (select count(distinct conversation_id) from cur),
      'before', (select count(distinct conversation_id) from prev)),
    'newPeople', (
      select count(distinct c.conversation_id) from cur c
        join firsts f on f.conversation_id = c.conversation_id
       where f.first_at > (select n from t) - interval '30 days'),
    'returning', (
      select count(distinct c.conversation_id) from cur c
        join firsts f on f.conversation_id = c.conversation_id
       where f.first_at <= (select n from t) - interval '30 days'),
    'fromAd', jsonb_build_object(
      'now', (select count(distinct conversation_id) from cur where ad_model is not null),
      'before', (select count(distinct conversation_id) from prev where ad_model is not null)),
    'byChannel', coalesce((
      select jsonb_object_agg(channel, k)
        from (select channel, count(distinct conversation_id) as k from cur group by 1) x), '{}'::jsonb),
    'byBrand', coalesce((
      select jsonb_object_agg(brand, k)
        from (select brand, count(distinct conversation_id) as k from cur group by 1) x), '{}'::jsonb),
    'cars', coalesce((
      select jsonb_agg(jsonb_build_object('code', code, 'people', k) order by k desc)
        from (select code, count(distinct conversation_id) as k
                from cur, unnest(models || coalesce(context_models, '{}')) as code
               group by 1 order by 2 desc limit 6) x), '[]'::jsonb),
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object('topic', i, 'people', k) order by k desc)
        from (select i, count(distinct conversation_id) as k
                from cur, unnest(intents) as i
               where i in ('PRICE', 'FINANCING', 'TEST_DRIVE', 'AVAILABILITY', 'BUYING_INTENT', 'TRADE_IN', 'DISCOUNT')
               group by 1 order by 2 desc limit 6) x), '[]'::jsonb),
    'people90d', (select count(distinct conversation_id) from sig),
    'buyingQuestion90d', (
      select count(distinct conversation_id) from sig
       where intents && array['PRICE', 'FINANCING', 'TEST_DRIVE', 'BUYING_INTENT', 'AVAILABILITY', 'DISCOUNT', 'TRADE_IN']),
    'reply', (
      select jsonb_build_object(
               'asked', count(*),
               'answered', count(replied),
               'medianMinutes', round((percentile_cont(0.5) within group (order by mins) filter (where replied is not null))::numeric),
               'withinHour', count(*) filter (where mins <= 60),
               'neverAnswered', count(*) filter (where replied is null))
        from rt)
  );
$$;
comment on function public.brief_client_summary(text[]) is
  'Migration 035: the clients, counted, for the Monza app''s Morning Briefing — people who wrote (30 days and the 30 before), new / returning, from an ad, by channel and brand, cars and buying questions, and WhatsApp reply speed (a person''s replies only). Counts only: no word, name, number or chat id. Service role only.';
revoke all on function public.brief_client_summary(text[]) from public, anon, authenticated;
grant execute on function public.brief_client_summary(text[]) to service_role;
