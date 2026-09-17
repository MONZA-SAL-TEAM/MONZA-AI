# The MONZA Customer Search & Media Engine

`lib/wasales/` — built 2026-09-14 from Samer's specification. It reads a
customer's message on Instagram, Messenger or WhatsApp and decides, with no AI
anywhere on the path, what Monza **would** send: the model's brochure, approved
facts, colour choices, a colour's video, or the contact number.

**It never sends by itself.** Since 2026-09-15 the inbox shows its suggested
reply for each open chat and a person presses Send — see
[Suggestions in the inbox](#suggestions-in-the-inbox). The `/sales` simulator
runs the same engine.

---

## Before: what the old flow did

Written down before it was replaced, so the change can be judged.

`lib/wasales/flow.ts` was a hand-written state machine, `advance(input, state,
catalog, media)`, with stages `new → awaiting_model → awaiting_brochure →
awaiting_colour → sent → human`.

| Behaviour | Old flow |
|---|---|
| Who it answered | Only a **never-seen number**, and only its **first message** (`isNewNumber`, `isFirstMessage`). Every returning customer, and every later message that was not the answer to its own question, was held for a person. |
| Brochure | **Offered** with "Would you like us to send you its brochure?", read by a yes/no reader (`yes-no.ts`), sent on "yes". |
| Colour | Asked after the brochure; only colours with a video were listed; a colour named early was remembered. |
| After the video | Went silent for good (`sent` → `human`). |
| Facts, price, location, hours | None. Any question that was not one of its three was held. |
| Unclear answers | Two tries per question, then a person. |
| Arabic | Normalized to an empty string — unreadable. |
| Channels | Framed as WhatsApp only; ran only in the simulator. |

In the first-message study (482 real conversations) 55% of customers wrote more
than once, and the most common opener, "Can I know more info?", came from the
Instagram ad button. The old rules answered only the first of those messages.

## After: three deterministic stages

```
message ──► UNDERSTAND ───────────────► SEARCH ─────────────────► EXECUTE
            intent.ts                    engine.ts decide()         templates.ts renderPlan()
            what was asked (intents,     looks answers up in        fixed sentences, choices shaped
            language, payload, number,   approved knowledge and     per channel (quick replies,
            exclusion)                   uploaded media; returns    buttons, list, numbered)
            engine.ts understand()       ORDERED ACTIONS            actions.ts applySendPolicy()
            which model, which colour                               may any of it go out?
```

`flow.ts` is now a thin runner: `runTurn(input, state, deps, send)` →
`{ decision, plan, policy, trace }`. The simulator calls exactly this.

| File | Holds |
|---|---|
| `matcher.ts` | Unicode normalization (Arabic kept, hamza/taa marbuta folded, Arabic-Indic digits), Arabic prefixes, model matching (no fuzzy matching on Arabic) |
| `intent.ts` | The closed vocabulary per intent (EN / AR / Arabizi), longest-phrase-wins, weak words, safe typos, language, payloads, numbered answers, hard exclusions |
| `context.ts` | `SearchEngineState`, `SALES_CONTEXT_TTL_HOURS`, validated `parseState` |
| `knowledge.ts` | Models, brands, `ApprovedFact`s, contact number, channel limits, the readiness report |
| `actions.ts` | The action vocabulary, the fixed order, the send policy |
| `engine.ts` | `decide()` and `traceForLog()` |
| `templates.ts` | Every customer-facing sentence, the channel executor, staff labels |
| `flow.ts` | The runner |

## The state machine

One `SearchEngineState` per conversation:

| Field | Meaning |
|---|---|
| `activeModel` | The model being discussed |
| `selectedColour` | Its colour, once chosen |
| `pendingIntents` | Model-dependent questions asked before the model was known, in order |
| `awaiting` | `NONE`, `MODEL` or `COLOUR` |
| `lastIntent` | For reporting |
| `modelActivationId` | +1 every time a model becomes active |
| `brochureSentForCurrentActivation` / `colourPromptSentForCurrentActivation` | Stop repeats within one activation |
| `offeredModels` / `offeredColours` | What was offered, in order, so "2" or "the second one" answers it |
| `updatedAt` | The last message's own timestamp |

Transitions:

- **NONE → MODEL**: a model-dependent question with no model ("hp?", "price?",
  "more info?"), a greeting that opens a new conversation, or two models at once
  / a brand with no model ("the dream or the passion?", "mhero?").
- **→ activation**: a model named by a button, the words, a numbered or ordinal
  answer, or a configured ad referral, when it is not already the active model.
  The activation resets the colour and prompts, then sends: **brochure → pending
  answers in order → colour step**.
- **Colour step**: two or more colours with a video → **COLOUR**. One → its video
  goes out at once, naming no colour. None → a content gap and the contact number.
- **COLOUR → NONE**: a colour (typed, tapped or numbered) → its video.
- **A different question while awaiting COLOUR** is answered, and the colour
  question stays open. It is not handed off.
- **A new model while awaiting anything** is a new activation.
- **Expiry**: more than `SALES_CONTEXT_TTL_HOURS` (default 72) since the last
  message resets the state before reading. This is separate from Meta's 24-hour
  window, which the send policy enforces.
- **Excluded events** leave the state exactly as it was.

A bare greeting in an old conversation with no live context →
`NO_AUTOMATIC_ACTION`. A returning customer's real question is answered.

## The exact action order

Whatever order the engine found things in:

1. `SEND_BROCHURE`: always first on an activation
2. `SEND_FACT`: approved facts, in the order asked
3. `SEND_GLOBAL_INFO`: location or opening hours, when approved
4. `SEND_COLOUR_VIDEO`
5. `COLOUR_NOT_AVAILABLE`
6. `SEND_CONTACT_FALLBACK`: **at most one**, carrying every reason
7. `SHOW_COLOUR_CHOICES`
8. `SHOW_MODEL_CHOICES`: a question is always last

`CONTENT_GAP` and `FLAG_FOR_STAFF` are internal and never sent. The definition of
done, with test facts approved:

| Message | Actions |
|---|---|
| `hp?` | SHOW MODEL CHOICES (pending HORSEPOWER) |
| tap COURAGE | SEND COURAGE BROCHURE · SEND COURAGE HORSEPOWER · SHOW COURAGE COLOURS |
| `BLACK` | SEND COURAGE BLACK VIDEO |
| `range?` | SEND COURAGE RANGE |
| `what about Passion L?` | SEND PASSION L BROCHURE · SHOW PASSION L COLOURS |
| `what's the range?` | SEND PASSION L RANGE |

With the knowledge as shipped (no fact approved), step 2 is brochure →
"For more information, please call 70 70 85 85." → colours, plus
`MISSING APPROVED FACT: COURAGE / HORSEPOWER`.

## What gets the contact number

"For more information, please call 70 70 85 85." — one message, whatever the
reasons:

- a fact that is missing, unapproved, empty or zero (each a different gap)
- price, installments, test drive, availability, discount, trade-in, service,
  parts, complaints (a complaint also flags staff)
- location or opening hours with no approved value; "what's your number?"
- a model with no brochure, or no colour with a video
- another brand's model, and a model switched off on `/sales`

## Brand isolation

The brand is the **receiving account's**, taken from its verified id (CLAUDE.md
rule 1). VOYAH accounts sell FREE 318, COURAGE, DREAM, PASSION, PASSION L and
TAISHAN. MHERO accounts sell MHERO 1 and 2. MONZA SAL accounts sell all eight. A
model the account does not sell gets the contact number. Its brochure, videos and
facts are never sent. Each model's files come only from its own catalogue folder,
so the PASSION and the PASSION L can never share material.

## Send gates

`applySendPolicy()` runs after the engine and blocks, with a reason for each:

- the auto-send switch is off
- a person has taken the conversation over
- the conversation is outside the 24-hour window
- live sending is off (rule 24)
- the adapter cannot send files
- a file is over the channel limit or in the wrong format
- a fact or global value is no longer approved as sent

The plan goes out whole or not at all.

## Suggestions in the inbox

Samer's decisions (2026-09-15): **suggest only, never automatic**; all three
channels; **quiet for the rest of the chat** once a person writes their own
reply; small MP4 copies of the colour videos.

1. Staff open a chat. `SalesSuggestion.tsx` asks `GET /api/sales/suggestion`,
   which reads the chat the way the inbox does (`readThreadForStaff`: live
   from Meta for Instagram and Facebook, from our store for WhatsApp), lists
   the shared sales library (`library-server.ts`), and runs the engine over
   the customer's messages since our last reply (`suggest.ts`).
2. The card shows the exact sentences, the files (name, size), the choices,
   what is missing, and anything that blocks sending. Send this · Copy text ·
   Dismiss.
3. **Send this** (`POST /api/sales/suggestion/send`) works the suggestion out
   again from the chat as it is now, refuses if it changed, claims it, and
   sends it part by part through the same gates as a typed reply, stopping at
   the first failure. WhatsApp copies are recorded with `automation_id`
   `sales-suggestion:…`.
4. The engine's next state and the Meta ids of what went are saved in
   `sales_suggestion_state` (migration 012). An outgoing message that is
   neither of ours was written by a person: suggestions stop for that chat
   until "Suggest again".

| Part | WhatsApp | Messenger | Instagram |
|---|---|---|---|
| Brochure | `document.link` + filename, ≤100 MB | `attachment` file by URL, ≤25 MB | same as Messenger |
| Colour video | `video.link`, MP4 ≤16 MB | `attachment` video by URL, ≤25 MB | same |
| Choices | ≤3 reply buttons · ≤10 list rows · else numbered | ≤13 quick replies | ≤13 quick replies |

A file over the channel's limit goes as a link inside the sentence. A button
tap comes back as its title ("Voyah Courage", "Black"), which the engine
reads like typed text.

## Persistence

`database/migrations/012_sales_suggestion_state.sql` keeps one row per chat,
keyed by the account and the conversation's reference on it (Meta's
conversation id, or our WhatsApp conversation id):
- engine state
- the Meta ids of suggestion sends
- `resumed_at`
- an optimistic `rev`

It has a composite FK to `channel_accounts(id, brand)`, version, size and
id-count checks, and RLS on with no policies. It is **not applied**. The
customer's words are never stored in it. It replaces the unapplied 008 design
for automatic replies, which Samer did not choose.

## Missing business content

From the readiness report (the simulator's "Content readiness" panel, and
`tests/sales-knowledge.test.ts`):

- **No fact is approved for any model (0 of 9 × 8).** Candidates are recorded
  *unapproved*, quoting Monza's own video captions:
  - COURAGE: range 470 km, AWD full electric
  - PASSION L: PHEV
  - TAISHAN: 670 hp combined
  - MHERO 2: 700 HP and 1,300 km combined (CLTC)

  A person must confirm each one against the brochure.
- **Location and opening hours**: missing.
- **Arabic and French templates**: none. Arabic customers are understood but
  answered in English.
- **FREE 318 ↔ the "Voyah Free Comp" folder**: needs confirmation.
- **Colours with no video** (in the folder): Passion / Black (so the Passion
  has none), Mhero 1 / Black. The Dream's videos are not sorted by colour.
- **Files too big for a channel**:
  - Passion brochure 71.6 MB (over Instagram and Messenger's 25 MB)
  - Courage White 121 MB `.mov`
  - Free Comp Green 65.7 MB
  - Taishan Black/Blue about 50 MB `.mov`
  - Free Comp Sage 28 MB `.mov`

  WhatsApp takes MP4 or 3GP up to 16 MB. Channel-sized MP4 copies are needed.
- **No ad is mapped to a model** (`knowledge.referrals` is empty), so no
  referral activates a model yet.
- **The WhatsApp number is treated as MONZA SAL** in the simulator. Confirm.

## Before any AUTOMATIC reply (not chosen — Samer, 2026-09-15)

Suggestions are sent by a person, so none of this applies to them. If
replies without a person are ever wanted, all of this comes first:

1. **Rule 24 must be lifted by Samer**, explicitly and in writing.
2. **No adapter sends files or choices.** `OutboundMessage` is
   `{accountId, toExternalId, text}`. Brochures, videos, quick replies and
   buttons all need adapter work on Messenger, both Instagram routes and a
   WhatsApp adapter that does not exist yet.
3. **The webhook never calls the engine.** Wiring it needs:
   - migration 008 applied
   - the engine to run only when `storeInbound` really inserted (Meta redelivers)
   - a real human-lock signal, for example a recent staff reply
   - a per-conversation rate limit on automated messages
4. **Instagram-login webhooks are not configured.** Instagram messages read
   through the Instagram-login route never reach the webhook, so the engine
   could not see them.
5. **Media must be served in channel-sized copies** at URLs Meta can fetch.
6. **The content above**: approved facts, location, hours, Arabic wording.

## Testing

`npm run verify` runs typecheck, tests and build. The engine is covered by:

| File | Covers |
|---|---|
| `tests/sales-engine.test.ts` | The definition of done, every rule, the study openers, and the §60 invariants on every account |
| `tests/sales-intent.test.ts` | The vocabulary, languages, payloads, numbered answers and exclusions |
| `tests/sales-templates.test.ts` | Wording, channel choice styles and the send policy |
| `tests/sales-knowledge.test.ts` | Knowledge, readiness and state |
| `tests/sales-catalog.test.ts` | The real catalogue |
| `tests/sales-flow.test.ts` | The runner, and a log line that carries no customer text |
| `tests/sales-words.test.ts` | Normalization and model words |

## The autoreply pilot (2026-09-16)

Samer: "begin automation only between the chat between those 2 numbers" — his
test phone (+961 3 195 955, WhatsApp id `9613195955`) writing to the business
WhatsApp (`wa-monza`, +961 70 708 585). It is the ONE exception to CLAUDE.md
rule 24; every other chat keeps the suggestion card.

- **Who:** `lib/wasales/autoreply-pilot.ts` — accounts and customers listed in
  code, frozen. Nobody else is ever answered automatically.
- **When:** the webhook stores a message; only a NEW customer message
  (`StoreResult.fresh`) wakes `lib/wasales/autoreply.ts`. A Meta redelivery
  is never new, so it cannot answer twice.
- **What:** `autoreplyThread` in `suggestion-server.ts` sends exactly what the
  suggestion card would show, through the same checks (24-hour window,
  `CHANNELS_SEND_MODE`, the key, handover, whole-plan check, `rev` claim).
  After sending it looks again, so a second message that arrived meanwhile is
  answered in the same run (at most 3 rounds, 12 s).
- **Where the chat begins:** the first answer saves `started_at` just before
  the message that woke it. Older tests and replies typed on the phone are
  ignored, so the engine treats it as a new conversation and welcomes.
- **Recorded** as author `automation` with `automation_id` `sales-autoreply:…`
  (the inbox shows "Automatic").
- **Stops** when a person types a reply in that chat (handover, as for
  suggestions), or everywhere with `SALES_AUTOREPLY_MODE=off` + a redeploy.
- **Logs** counts and stop reasons only, never words or numbers:
  `[sales/autoreply] wa-monza: rounds 1, sent 3, stopped: nothing_to_answer`.

## 2026-09-17: production hardening (Samer's eight phases)

- **Everyone outside the pilot is marked, never answered, never dropped.**
  `lib/wasales/triage.ts` reads each new WhatsApp message from a non-pilot
  chat (rules only), files it as PRICE / FINANCING / TEST_DRIVE / STOCK /
  DISCOUNT / TRADE_IN / CALLBACK / HUMAN / QUESTION or NEEDS_PERSON with the
  model, and `recordAlert` writes a `sales_alerts` row (kinds in migration
  016). The reason names the topic and the model code, never the customer's
  words. The inbox strip shows it and the chat row carries "Needs a person".
  `SALES_AUTOREPLY_MODE=off` stops replies; marking continues.
- **No silent ignores in the pilot:** a photo with no words, text the rules
  do not read, or a message after "talk to a human" raises a NEEDS_PERSON
  alert (`needsPerson` in `suggest.ts`, applied by the autoreply loop).
- **A person's reply pauses the bot, it does not kill it.** The bot stays out
  while the person's conversation is live and resumes when the customer's
  newest message comes `SALES_HANDOVER_RESUME_HOURS` (default 12) after the
  person's last reply, answering only what came after it. "Hand to a person"
  in the inbox holds it out until "Suggest again". `tests/sales-handover.test.ts`.
- **Held facts.** `PENDING_CONFIRMATION` in `scripts/sales-import-workbook.py`
  keeps a conflicting workbook value EMPTY (`confirmed: false`, `pending`
  holds the raw text) so the bot says "not confirmed yet" and the send policy
  blocks the figure. The list, with the reason for each, is
  `docs/SALES-FACTS-DISCREPANCIES.md`; remove a row from the set once Samer
  confirms it and re-run the script.
- **Arabic.** A message in Arabic script is answered in Arabic
  (`RenderContext.lang`, `renderTextAr` and `pick()` in `templates.ts`);
  Arabizi and English get English. Model and colour names stay Latin. The
  Arabic wording was written for Samer's approval and any sentence without an
  Arabic version falls back to English.
- **After hours.** When a reply raises a sales alert outside Mon–Fri 08–18 /
  Sat 08–14 (Beirut), the bot adds the AFTER_HOURS_NOTE line (`isAfterHours`).
- **Typed test-drive times** ("tomorrow at 3", "Saturday afternoon", "18
  September at 4:30", "Monday 11am"): booked if free, nearest free slots if
  taken or closed, hours + free times on a closed day. "What time is my test
  drive", "cancel", "change it to Monday 11am" work on `state.booking`; a
  change cancels the old slot before booking, never two bookings.
- **The mandatory regression set** is `tests/sales-regression.test.ts`: 80
  conversations classified PASS / WRONG ANSWER / NO ANSWER /
  UNSAFE-INVENTED FACT / HANDOFF REQUIRED, with an invented-number check
  against the approved knowledge and an internal-label scan of every reply.
- **Not done yet, by Samer's order:** Instagram (last), ad/referral
  preselection (needs ad ids; `knowledge.referrals` is empty), WhatsApp
  messages to a staff phone (needs `SALES_ALERT_WHATSAPP_TO` and an approved
  template), brochure copies for Dream / Free 318 / Taishan / Passion L /
  MHERO 2 (upload from Samer's Chrome).
