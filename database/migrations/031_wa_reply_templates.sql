-- 031 — WhatsApp templates staff may send to a customer after the 24-hour window (Samer, 2026-10-20: "ability to
-- reply to messages even after 24 hours").
--
-- WhatsApp delivers nothing but an APPROVED template to someone who has not written in 24 hours, and charges for
-- it. A template is created and approved in WhatsApp Manager (Meta — Samer's side); an admin then lists it here by
-- its exact name and language, with its words ({{1}}, {{2}}… where the blanks are) so staff see what goes out.
-- MONZA AI never creates or edits a template at Meta.
--
-- ADDITIVE ONLY. RLS on, no policies: the server only.

create table if not exists public.wa_reply_templates (
  name text primary key check (name ~ '^[a-z0-9_]{1,512}$'),
  language text not null default 'en' check (language ~ '^[a-z]{2,3}(_[A-Z]{2})?$'),
  label text not null check (char_length(label) between 1 and 80),
  body text not null check (char_length(body) between 1 and 1024),
  params integer not null default 0 check (params between 0 and 10),
  enabled boolean not null default true,
  updated_by uuid,
  updated_by_name text check (updated_by_name is null or char_length(updated_by_name) <= 120),
  updated_at timestamptz not null default now()
);
alter table public.wa_reply_templates enable row level security;
