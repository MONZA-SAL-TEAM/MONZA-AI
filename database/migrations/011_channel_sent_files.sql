-- =============================================================================
-- 011_channel_sent_files.sql — files staff send on Instagram and Facebook
-- (2026-09-15).
--
-- Samer: "everything you have done from voice note and attachment send, also
-- apply it to Facebook and Instagram", and keep what is sent 12 months like
-- WhatsApp. That is a deliberate, narrow exception to the 2026-09-10 rule that
-- Instagram and Facebook conversations are read live and not copied: it covers
-- ONLY the files MONZA AI itself sends. Customers' words and files on
-- Instagram and Facebook are still never stored.
--
-- Instagram/Facebook threads have no message rows here (they are read from
-- Meta), so a sent file is recorded in its own table — which also keeps the
-- dashboard's message counts untouched. /api/channels/retention deletes the
-- files and then these rows after twelve months.
--
-- Additive only: one table, and four more file types on the private bucket.
-- =============================================================================

create table if not exists public.channel_sent_files (
  id                  uuid primary key default gen_random_uuid(),
  account_id          text not null,
  -- The same enum channel_accounts uses, so the foreign key below can bind.
  brand               public.monza_brand not null,
  -- Meta's conversation id: Instagram and Facebook threads are not stored.
  conversation_ref    text not null,
  -- Meta's id for the message that carried the file, when it gave one.
  external_message_id text,
  -- Where the file is kept in the private whatsapp-media bucket.
  path                text not null unique,
  kind                text not null check (kind in ('image', 'video', 'audio', 'document')),
  mime                text not null,
  size_bytes          bigint not null check (size_bytes > 0),
  staff_id            text,
  sent_at             timestamptz not null default now(),
  -- The brand comes from the account, and cannot disagree with it (rule 4).
  foreign key (account_id, brand) references public.channel_accounts (id, brand)
);

create index if not exists channel_sent_files_sent_at_idx
  on public.channel_sent_files (sent_at);

alter table public.channel_sent_files enable row level security;
revoke all on public.channel_sent_files from public, anon, authenticated;

-- Instagram and Facebook take MOV and WEBM videos, WAV voice notes, and
-- (Messenger) ZIP files.
update storage.buckets
   set allowed_mime_types = (
     select array_agg(distinct t)
       from unnest(
              allowed_mime_types
              || array['audio/wav', 'video/quicktime', 'video/webm', 'application/zip']
            ) as t
   )
 where id = 'whatsapp-media';
