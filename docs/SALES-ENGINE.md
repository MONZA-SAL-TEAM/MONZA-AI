# The MONZA Customer Search & Media Engine

`lib/wasales/` — built 2026-09-14 from Samer's specification. It reads a
customer's message on Instagram, Messenger or WhatsApp and decides, with no AI
anywhere on the path, what Monza **would** send: the model's brochure, approved
facts, colour choices, a colour's video, or the contact number.

**Nothing is sent.** The engine is called only by the simulator on `/sales`.
The send policy blocks every action while CLAUDE.md rule 24 stands, and no
channel adapter can send a file yet. See [Blockers to live use](#blockers-to-live-use).

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

## Persistence

`database/migrations/008_conversation_sales_state.sql` has one JSON state per
conversation. It uses a composite FK to `channel_conversations(id, brand)`,
cascades on delete, checks the version and the size, and has RLS on with no
policies. It is **not applied**. The customer's words are never stored in it.

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

## Blockers to live use

Passing tests is not permission to send. Before any automated reply:

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
