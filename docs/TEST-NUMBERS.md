# Test numbers — our own chats, not customers'

**The list is `lib/channels/test-chats.ts`. Adding to it is a code change on
purpose; nothing reads it from a database or a dashboard.**

| Channel | Identity | Who | Since |
|---|---|---|---|
| WhatsApp | `+961 3 195 955` → `9613195955` | Samer's own phone, writing to `wa-monza` (+961 70 708 585) | 2026-09-16 |

## What "a test number" means here

| | |
|---|---|
| Still arrives, is signature-checked, deduplicated and **stored** | yes — a test that is invisible proves nothing |
| Still shown in the Inbox, still answerable by a person | yes |
| Still answered by the autoreply pilot | yes, **but only because that chat is separately on the pilot list** |
| Opens a `leads` row | **no** |
| Records a `lead_touchpoints` row (attribution) | **no** |
| Records a `lead_interests` row (which car was named) | **no** |
| Auto-links to a CRM customer by phone | **no** — it cannot, there is no lead to link |

The point is the dashboard. A Lebanese mobile is the one identifier allowed to
join records without a person looking (`lib/leads/phone.ts`), so without this
list every test message put Samer's own phone into the lead table, under a
brand, with a car interest — and "where do customers come from" answered with a
number we dialled ourselves. Attribution is the figure somebody spends money
against.

## Two lists, and the direction between them

`lib/channels/test-chats.ts` says **"not a customer"**.
`lib/wasales/autoreply-pilot.ts` says **"a machine may answer this by itself"**
— the one named exception to CLAUDE.md rule 24, and Samer's decision every time
it widens.

They are separate files because listing a number as a test must never switch
automation on for it. The dependency runs one way, and
`tests/channels-test-chats.test.ts` asserts it: **every pilot chat must be a
test chat**; a test chat is not thereby a pilot chat. If that assertion ever
fails, the pilot was pointed at a real customer — the failure is the warning,
not the problem.

## Identity per channel

- **WhatsApp is a phone.** Compared through `samePhone`, so `03195955`,
  `+961 3 195 955` and `9613195955` are one number, and it is the same person on
  any WhatsApp account of ours. A number that cannot be normalised matches
  nothing — never a raw string compare.
- **Instagram and Messenger ids are scoped to the account they wrote to.** An
  entry must name the account, and the id is compared exactly. The same digits
  as a phone number on Instagram are a stranger, not the test number.

## Rows recorded BEFORE a number was listed

Skipping capture does not remove what is already in the database. Samer's test
phone has been writing to `wa-monza` since 2026-09-15, so lead rows for it very
likely exist.

**This has NOT been run.** It deletes production rows, it needs Samer's yes, and
it should be run as a `select` first to see what it would take:

```sql
-- 1. LOOK FIRST. Which leads are the test phone's?
select l.id, l.phone, l.display_name, l.first_seen_at, l.last_seen_at
from leads l
where l.phone = '9613195955';

-- 2. What hangs off them.
select 'conversations' as what, count(*) from lead_conversations
  where lead_id in (select id from leads where phone = '9613195955')
union all select 'touchpoints', count(*) from lead_touchpoints
  where lead_id in (select id from leads where phone = '9613195955')
union all select 'interests', count(*) from lead_interests
  where lead_id in (select id from leads where phone = '9613195955')
union all select 'suggestions', count(*) from lead_match_suggestions
  where lead_id in (select id from leads where phone = '9613195955');

-- 3. Only then, and only with Samer's yes. Children first.
--    This removes LEAD records only. The conversation and its messages in
--    channel_conversations / channel_messages stay — the chat itself is real
--    and Samer needs to see it.
-- delete from lead_match_suggestions where lead_id in (select id from leads where phone = '9613195955');
-- delete from lead_interests        where lead_id in (select id from leads where phone = '9613195955');
-- delete from lead_touchpoints      where lead_id in (select id from leads where phone = '9613195955');
-- delete from lead_conversations    where lead_id in (select id from leads where phone = '9613195955');
-- delete from leads                 where phone   = '9613195955';
```

`testPhonesE164()` prints the numbers in the form the `phone` column holds, so
the list and the SQL cannot drift apart silently.

## Adding another test number

1. Add the entry to `TEST_CHATS` with a note saying whose it is.
2. `npm run verify`.
3. If that number has already been messaging, run the look-first queries above
   and decide about the rows it already left.
4. Listing it does **not** make it auto-reply. That is a separate, deliberate
   change to the pilot list.
