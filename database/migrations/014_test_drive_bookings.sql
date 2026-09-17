-- =============================================================================
-- 014_test_drive_bookings.sql — the test-drive calendar (Samer's workbook,
-- C Decisions, 2026-09-17): "if a client books a time, don't let another client
-- have the same time". Monday–Friday 10:00–17:00, Saturday 10:00–14:00,
-- 30-minute slots, Beirut time (lib/wasales/booking.ts).
--
-- ONE BOOKING PER SLOT is enforced here, not in the application: the partial
-- unique index below refuses a second booked row for the same time, so two
-- customers tapping the same slot at the same moment can never both get it.
-- A cancelled booking frees its slot.
--
-- The customer's name lives on the matching sales alert (013); a booking holds
-- the time, the cars and the chat.
-- =============================================================================

create table if not exists public.test_drive_bookings (
  id                uuid primary key default gen_random_uuid(),
  slot_at           timestamptz not null,
  account_id        text not null,
  brand             public.monza_brand not null,
  conversation_ref  text not null check (conversation_ref ~ '^[A-Za-z0-9_.:=-]{1,200}$'),
  thread_id         text not null check (char_length(thread_id) <= 400),
  models            text[] not null default '{}' check (cardinality(models) <= 8),
  customer_phone    text check (customer_phone ~ '^[0-9]{7,15}$'),
  status            text not null default 'booked' check (status in ('booked', 'cancelled')),
  created_at        timestamptz not null default now(),
  cancelled_at      timestamptz,
  cancelled_by      text check (char_length(cancelled_by) <= 120),

  -- Slots start on the hour or the half hour, to the second.
  constraint test_drive_bookings_slot_shape
    check (extract(second from slot_at) = 0 and extract(minute from slot_at) in (0, 30)),

  constraint test_drive_bookings_account_fk
    foreign key (account_id, brand)
    references public.channel_accounts(id, brand)
    on delete cascade
);

create unique index if not exists test_drive_bookings_one_per_slot
  on public.test_drive_bookings (slot_at)
  where status = 'booked';

create index if not exists test_drive_bookings_upcoming
  on public.test_drive_bookings (status, slot_at);

-- RLS on, no policies: the server reads and writes with the service role only.
alter table public.test_drive_bookings enable row level security;
