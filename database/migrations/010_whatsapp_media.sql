-- =============================================================================
-- 010_whatsapp_media.sql — photos, videos, voice notes and files in the
-- WhatsApp inbox (2026-09-15).
--
-- Samer: "send and receive voice notes, photos, videos, PDF files and more".
-- Files are kept 12 months, like the words (his choice, 2026-09-15), and are
-- deleted with them by the daily clean-up (/api/channels/retention).
--
-- Meta keeps a file a customer sends for 7 DAYS only, so each one is copied
-- into this bucket when it arrives (lib/channels/wa-media-store.ts).
--
-- Additive only: one PRIVATE bucket and one function. Nothing existing changes.
-- =============================================================================

-- ── The bucket ──────────────────────────────────────────────────────────────
--
-- PRIVATE. Customers send photos of IDs, licences and cheques; nothing here is
-- ever public. No storage policy is added, so the anon and authenticated roles
-- can neither read nor list it: the server reads with the service role and
-- hands staff links that stop working after an hour, and the browser uploads
-- only through a one-time signed upload the server issues.
--
-- 100 MB is Meta's own ceiling (documents). It MUST match WA_MEDIA_MAX_BYTES in
-- lib/channels/wa-media.ts. application/octet-stream is a document of a type
-- the inbox never shows inline — it is only ever downloaded.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'whatsapp-media',
  'whatsapp-media',
  false,
  104857600,
  array[
    'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/3gpp',
    'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr',
    'application/pdf', 'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/octet-stream'
  ]
)
on conflict (id) do nothing;

-- ── The conversation list, with what the latest message carries ─────────────
--
-- channel_whatsapp_page (009) returns only HOW MANY attachments the latest
-- message had, so a photo reads as "an attachment". This returns them, so the
-- list can say "📷 Photo" or "🎤 Voice message". A new name rather than a
-- changed return type: the code falls back to 009's function until this runs,
-- and nothing breaks in between.

create or replace function public.channel_whatsapp_page2(
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
  last_attachments jsonb
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
         coalesce(m.attachments, '[]'::jsonb)
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

revoke all on function public.channel_whatsapp_page2(text, integer, integer)
  from public, anon, authenticated;
