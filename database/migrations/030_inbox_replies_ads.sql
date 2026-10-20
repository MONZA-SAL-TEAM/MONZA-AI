-- 030 — Inbox: which message a reply answers, and the ad a customer came from (Samer, 2026-10-20: "see the
-- image a client is referring to as it doesn't appear before the message").
--
-- ADDITIVE ONLY.
--
--   channel_messages.reply_to   WhatsApp's id of the message this one answers (`context.id` on a reply, from the
--                               customer or from the phone app). The thread shows that message quoted above it.
--   ad_creatives                one row per Click-to-WhatsApp ad (Meta's ad id): its headline, words and a COPY
--                               of its picture in the private bucket — Meta's link dies within weeks. The business's
--                               own ad, never a customer's file. RLS on, no policies: the server only.

alter table public.channel_messages
  add column if not exists reply_to text check (reply_to is null or char_length(reply_to) <= 200);

create table if not exists public.ad_creatives (
  source_id text primary key check (char_length(source_id) between 1 and 64),
  headline text check (headline is null or char_length(headline) <= 300),
  body text check (body is null or char_length(body) <= 2000),
  media_type text check (media_type is null or media_type in ('image', 'video')),
  image_path text check (image_path is null or char_length(image_path) <= 200),
  source_url text check (source_url is null or char_length(source_url) <= 1000),
  captured_at timestamptz,
  tried_at timestamptz not null default now()
);
alter table public.ad_creatives enable row level security;
