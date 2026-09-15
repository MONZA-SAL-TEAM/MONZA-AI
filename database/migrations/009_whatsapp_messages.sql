-- =============================================================================
-- 009_whatsapp_messages.sql — WhatsApp in the inbox (2026-09-15).
--
-- WhatsApp cannot be read back from Meta, so its messages are STORED (Samer's
-- decision, 2026-09-15) — see lib/channels/whatsapp.ts. Instagram and Facebook
-- are unchanged: still no words.
--
-- Numbered 009 on purpose: 007 (privacy) and 008 (sales engine) exist as
-- UNAPPLIED files in other worktrees, and reusing their numbers would make the
-- order of the migration history a guess.
--
-- Additive only: three functions and one index. Nothing existing is altered.
-- =============================================================================

-- ── Our own side of a WhatsApp thread ───────────────────────────────────────
--
-- A reply staff typed in the WhatsApp Business app arrives as an echo. It moves
-- the thread's position, and marks it as waiting on the customer — but only if
-- it is newer than their last message, so an echo redelivered late cannot mark
-- a thread "waiting" that the customer has since written into. It never counts
-- as unread and never touches the 24-hour window, which runs from the
-- CUSTOMER's last message.

create or replace function public.channel_note_outbound(
  p_conversation uuid,
  p_at timestamptz
) returns void
language sql
security definer
set search_path = public
as $$
  update public.channel_conversations
     set last_message_at = greatest(coalesce(last_message_at, p_at), p_at),
         status          = case
                             when p_at >= coalesce(last_inbound_at, p_at) then 'waiting_reply'
                             else status
                           end,
         updated_at      = now()
   where id = p_conversation;
$$;

revoke all on function public.channel_note_outbound(uuid, timestamptz)
  from public, anon, authenticated;

-- ── One page of WhatsApp conversations, each with its latest message ────────
--
-- One round trip instead of one per conversation. WhatsApp accounts only: the
-- join on channel = 'whatsapp' means this can never return an Instagram or
-- Facebook row, whose bodies are empty by design.

create or replace function public.channel_whatsapp_page(
  p_account text,
  p_limit integer,
  p_offset integer
) returns table (
  id               uuid,
  peer_external_id text,
  peer_display     text,
  customer_id      text,
  status           text,
  last_inbound_at  timestamptz,
  last_message_at  timestamptz,
  last_body        text,
  last_direction   text,
  last_author      text,
  last_sent_at     timestamptz,
  last_attachments integer
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id,
         c.peer_external_id,
         c.peer_display,
         c.customer_id,
         c.status,
         c.last_inbound_at,
         c.last_message_at,
         m.body,
         m.direction,
         m.author,
         m.sent_at,
         coalesce(jsonb_array_length(m.attachments), 0)
    from public.channel_conversations c
    join public.channel_accounts a
      on a.id = c.account_id
     and a.channel = 'whatsapp'
    left join lateral (
      select x.body, x.direction, x.author, x.sent_at, x.attachments
        from public.channel_messages x
       where x.conversation_id = c.id
       order by x.sent_at desc
       limit 1
    ) m on true
   where c.account_id = p_account
   order by c.last_message_at desc nulls last, c.id
   limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$$;

revoke all on function public.channel_whatsapp_page(text, integer, integer)
  from public, anon, authenticated;

-- ── The 12-month rule ───────────────────────────────────────────────────────
--
-- Called once a day by /api/channels/retention (Vercel Cron). Deletes WhatsApp
-- messages sent before p_before, then WhatsApp conversations left with none and
-- no activity since — they hold a name and a phone number, which are personal
-- data too. A lead linked to a removed conversation keeps its lead row;
-- lead_conversations cascades.

create index if not exists channel_messages_account_time_idx
  on public.channel_messages (account_id, sent_at);

create or replace function public.channel_purge_whatsapp(p_before timestamptz)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.channel_messages m
   using public.channel_accounts a
   where a.id = m.account_id
     and a.channel = 'whatsapp'
     and m.sent_at < p_before;
  get diagnostics removed = row_count;

  delete from public.channel_conversations c
   using public.channel_accounts a
   where a.id = c.account_id
     and a.channel = 'whatsapp'
     and coalesce(c.last_message_at, c.created_at) < p_before
     and not exists (
       select 1 from public.channel_messages m where m.conversation_id = c.id
     );

  return removed;
end;
$$;

revoke all on function public.channel_purge_whatsapp(timestamptz)
  from public, anon, authenticated;
