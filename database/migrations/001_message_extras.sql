-- Answers carry more than text: small data tables and recommended follow-up
-- questions. Stored per assistant message so history replays exactly what the
-- staff member saw.
alter table public.messages
  add column if not exists tables    jsonb not null default '[]'::jsonb,
  add column if not exists followups jsonb not null default '[]'::jsonb;
