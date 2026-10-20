-- 032 — A WhatsApp message edited or deleted AFTER it was sent (Samer, 2026-10-20: "why can't I delete or
-- modify a message").
--
-- Meta's Cloud API lets nobody delete or edit a sent message (verified against Meta's documentation,
-- 2026-10-20). On a Coexistence number the WhatsApp Business APP still can — edit within 15 minutes, "delete
-- for everyone" within 2 days — and Meta then tells us: `smb_message_echoes` type `edit` / `revoke` for the
-- team's own messages, `messages` type `edit` / `revoke` for the customer's. Until today those were dropped,
-- so the inbox kept showing a message the phone had deleted (86 team deletions and 29 edits since
-- 2026-09-15, 36 and 19 by customers). Now they are mirrored:
--
--   deleted_at  the message was deleted for everyone: its words and files are removed from our copy and the
--               thread shows "This message was deleted" (WhatsApp's own wording).
--   edited_at   the words were replaced by the edited ones; the thread marks it "edited".
--
-- ADDITIVE ONLY.

alter table public.channel_messages
  add column if not exists deleted_at timestamptz,
  add column if not exists edited_at timestamptz;
