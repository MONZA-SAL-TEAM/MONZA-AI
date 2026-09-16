# The test number — rehearsed as a client

**Samer, 2026-09-16: "any time that number sends a message to 70708585 always
treat it as a client so that i can test all the questions."**

| Channel | Identity | Account | Who |
|---|---|---|---|
| WhatsApp | `+961 3 195 955` → `9613195955` | `wa-monza` (+961 70 708 585) | Samer's own phone |

The list is `lib/wasales/rehearsal-chats.ts`. It is code, not a setting.

## What it means

The number is **not special-cased**. A message from it takes the same path a
stranger's does, and that is the point — a rehearsal that skipped the real path
would rehearse nothing.

| | |
|---|---|
| Stored, deduplicated, routed to the brand, shown in the Inbox | yes |
| Opens a `leads` row, a `lead_touchpoints` row, a `lead_interests` row | **yes** |
| Auto-links to a CRM customer by phone | **yes** — a Lebanese mobile is the one identifier allowed to link without a person |
| Counted on the dashboard | **yes** — see the cost below |
| Answered by the autoreply pilot | yes, because that chat is *separately* on the pilot list |

**The one difference.** `detectExclusion` (`lib/wasales/intent.ts`) refuses to
answer a message whose whole text is `test`, `testing`, `hi test`, `test 2`.
That rule exists so somebody poking the system does not get a brochure — and it
is the exact rule that would silence the person poking it on purpose. In a
rehearsal chat that one filter is off, so "test" reads as an ordinary message
with nothing in it, and the engine answers the way it answers any message it
did not understand.

**Every other exclusion still applies**, because a client gets them too: a fake
Meta-support message, a vendor pitch and Meta's own chat notice are still
excluded here. "Treat it as a client" is the whole rule, not a licence.

Nothing about *understanding* changes. `tests/sales-rehearsal.test.ts` asserts
that the intents, language and confidence of a real question are identical with
the flag on and off — otherwise the rehearsal would be testing a different
product from the one customers get.

## The cost, stated plainly

**The dashboard counts these messages as demand.** Every test opens or touches
a lead carrying `9613195955`, under whichever brand received it, with whatever
car the message named. That is the price of the rehearsal being real, and it is
a decision rather than an oversight.

Two ways to keep a figure honest when it matters:

```sql
-- What our own testing has contributed.
select l.id, l.first_seen_at, l.last_seen_at,
       (select count(*) from lead_touchpoints t where t.lead_id = l.id) as touchpoints,
       (select count(*) from lead_interests  i where i.lead_id = l.id) as interests
from leads l
where l.phone = '9613195955';

-- Any figure, with the rehearsal excluded.
--   ... where lead_id not in (select id from leads where phone = '9613195955')
```

If the number ever becomes noisy enough to distort a real decision, the fix is
a `is_test` column on `leads` set at capture time and excluded in
`lib/leads/analytics.ts` — a migration, so Samer's call, and not worth it for
one number.

## Two lists, and the direction between them

`lib/wasales/rehearsal-chats.ts` says **"this chat is ours to test in"**.
`lib/wasales/autoreply-pilot.ts` says **"a machine may answer this by itself"**
— the one named exception to CLAUDE.md rule 24, and Samer's decision every time
it widens.

They are separate files so that listing a chat as a rehearsal can never switch
automation on for it. `tests/sales-rehearsal.test.ts` asserts the direction:
**every pilot chat must be a rehearsal chat**, never the reverse. If that
assertion fails, the pilot is pointed at a real customer.

## Identity per channel

- **WhatsApp is a phone**, compared through `samePhone`, so `03195955`,
  `+961 3 195 955` and `9613195955` are one number. A number that cannot be
  normalised matches nothing — never a raw-string compare.
- **Instagram and Messenger ids are opaque and scoped to the account** they
  wrote to, so they are compared exactly. The same digits as a phone number on
  Instagram are a stranger.
- **Every entry names the account**, because Samer named one: "that number …
  to 70708585". The same phone writing to another account of ours is not a
  rehearsal there until somebody says so.

## Adding another rehearsal chat

1. Add the entry to `REHEARSAL_CHATS` with a note saying whose it is.
2. `npm run verify`.
3. Listing it does **not** make it auto-reply. That is a separate, deliberate
   change to the pilot list.
