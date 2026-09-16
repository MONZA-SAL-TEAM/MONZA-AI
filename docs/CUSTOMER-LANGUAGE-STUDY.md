# What customers actually say — the WhatsApp corpus study

**Read 2026-09-16 from `channel_messages` in the MONZA AI project
(`fpsgsgldepgcowyivoow`), account `wa-monza` (+961 70 708 585).**

Built to answer one question: *what do people actually write to Monza, so that
the right answers can be written for them?*

**No customer's words are kept in this file.** Patterns are paraphrased, counts
are aggregate, and no phone number, name or message body appears — the same
discipline `catalog-data.ts` already follows. This repository is public.

---

## 0. The limit of this study — read before quoting any number

**This corpus is TWO DAYS of ONE channel.** 153 inbound text messages across
92 conversations, 2026-09-15 → 2026-09-16, WhatsApp only.

It is not "all the chats", and it cannot be, because:

- **Instagram and Facebook message text is never stored on our servers.** That
  is Samer's own 2026-09-10 rule, still in force. `channel_messages` holds 8
  non-WhatsApp inbound rows in total and **not one of them has a body** — the
  Inbox renders Instagram and Facebook live from Meta and keeps its only copy
  in the staff member's browser (`lib/inbox/cache.ts`). So Instagram (8,142 followers across the three brands) and Facebook
  (973) contributed **zero words** here.
- **WhatsApp history before 2026-09-15 does not exist here either.** The Cloud
  API cannot list past conversations. Nothing from before the connection was
  made can be recovered.
- The earlier **first-message study (2026-09-14, 482 conversations)** was run on
  a separate export and kept no words; only its shape survives, in
  `SAMPLE_MESSAGES`. This study is consistent with it and does not replace it.

**[Certain]** Everything below is true of WhatsApp on those two days.
**[Likely]** The intent MIX generalises to Instagram and Facebook, because 39%
of these conversations were opened by the Instagram/Facebook ad CTA and are
therefore the same traffic arriving on a different pipe.
**[Speculative]** Absolute volumes and the language split on Instagram DMs.
Do not plan capacity from this.

### How to get the rest, in order of cost

1. **Free, today:** each staff member's Inbox browser cache already holds the
   Instagram and Facebook history they have scrolled. Export from there.
2. **Cheap, permanent:** extend storage to Instagram/Facebook inbound text the
   way WhatsApp was extended on 2026-09-15 (migration 009 pattern, 12-month
   purge). This is a decision for Samer, not a side effect — it reverses the
   2026-09-10 no-copy rule for those channels.
3. Re-run this study monthly once (2) exists.

---

## 1. The corpus

| | |
|---|---|
| Conversations | 92 |
| Inbound messages | 199 |
| …carrying text | 153 (77%) |
| …carrying no text | 46 (23%) |
| Window | 2026-09-15 10:16 → 2026-09-16 14:36 UTC |
| Median conversation | 1 text message (mean 1.7, max 15) |

**63 of 92 conversations (68%) contain exactly one text message.** The
first-message study found 55% of customers wrote *more* than once; here most
wrote once and stopped. **[Speculative]** the difference is the channel — a
WhatsApp enquiry that gets the offer block pasted back needs no second message,
where an Instagram DM does. Either way, **the first reply usually has to be the
whole answer**, because there is often no second turn to recover in.

**What arrives that is not text** (counted on inbound attachments):

| Kind | Count |
|---|---|
| Image | 23 |
| **Audio / voice note** | **18** |
| Document | 5 |
| Sticker | 2 |
| Video | 1 |

**[Certain] A text-only bot is deaf to ~9% of inbound messages.** Eighteen voice
notes in two days is not an edge case — it is a Lebanese WhatsApp norm. A
customer who sends a voice note and gets a reply that ignores it has been
told the business is not listening. The engine has no transcription path and
`readMessage("")` reads an empty string as `UNKNOWN`.

---

## 2. What customers ask, ranked — conversation level

Tagged by topic against the real text, at **conversation** level (a topic counts
once per conversation however often it is repeated), n = 92.

| Topic | Convs | % | What it looks like |
|---|---|---|---|
| Generic "more info" | 50 | **54%** | the ad CTA, "more details", "tafasil aktar", "معلومات" |
| Greeting only, no content | 21 | 23% | hi / hello / bonjour / مرحبا / sabaho |
| **Price** | 14 | **15%** | "price?", "how much", "شو السعر", "se3er", incl. the typo "Pricr" |
| **Down payment** | 11 | **12%** | "down payment?", "first payment", "awal daf3a", "adai daf3a oula" |
| Model named | 10 | 11% | Free 318, Courage, Passion (and Passion S/L), MHERO I & II |
| Thanks / acknowledgement | 10 | 11% | thanks, ok, 👍, "okay deal" |
| **Financing terms** | 8 | **9%** | "in-house finance?", "0% interest", "كيف طريقة الدفع" |
| **Installments** | 6 | **7%** | "how many months", "the 800 usd installment", "تقسيط" |
| Specs | 6 | 7% | range, AWD, hybrid, "full option", "EV cars available" |
| Availability / year | 3 | 3% | "which model", "year", "still available" |
| Test drive | 3 | 3% | the ad CTA + "ممكن نعمل test drive" |
| VAT / TVA | 2 | 2% | "Tva?" |
| Trade-in (mileage offered) | 2 | 2% | a bare odometer figure, e.g. "64000 km" |
| Brochure / catalogue | 2 | 2% | |
| Cheaper / discount | 1 | 1% | "في ارخص ؟" |
| Eligibility / requirements | 1 | 1% | "شو المطلوب لإحصل على السيارة" |
| VIN / existing vehicle | 1 | 1% | a bare 17-character VIN |

### The finding that should change the product

| | Conversations | % |
|---|---|---|
| Asked about **money** (price, down payment, installments, financing, VAT, discount) | **28** | **30%** |
| Asked about **specs** (hp, range, battery, powertrain, dimensions, seats) | 6 | 7% |

**[Certain] Money outranks specifications 4.7 : 1.**

The Search Engine is built the other way round. `FACT_INTENTS` — the nine
intents with an approved-fact lookup, a knowledge entry and a send path — are
HORSEPOWER, RANGE, BATTERY, POWERTRAIN, CHARGING, SEATS, DIMENSIONS,
SPECIFICATIONS, WARRANTY. Every money intent (PRICE, FINANCING, DISCOUNT,
TRADE_IN) routes to *"For more information, please call 70 70 85 85."*

So the engine has machinery for the 7% and a hand-off for the 30%.

Worse: **the shipped knowledge approves no fact at all**, so even the 7% gets
the contact number today. The engine's only substantive answers right now are
the brochure and the colour video.

---

## 3. Openers — 39% of conversations are one exact string

| Opener | Convs | Source |
|---|---|---|
| `Can I know more info?` | **36 (39%)** | Instagram/Facebook ad CTA, verbatim |
| Bare greeting, nothing else | ~21 (23%) | typed |
| `Can I book a Test Drive?` | 2 | ad CTA, verbatim |
| `Hello MONZA SAL, I'm interested in the <MODEL>.` | 2 | **wa.me click-to-chat prefill — names the model** |
| Everything else | the tail | typed |

**27% of all inbound messages are machine-generated strings**, not typed
sentences. Three consequences:

1. **`Can I know more info?` should be a first-class trigger, matched exactly.**
   It is today read as `GENERAL_INFO` with confidence `high`, which is correct
   — but it is treated as if a human composed it. It is a button. It carries no
   model, and the customer has *already told Meta* which ad they tapped: the
   referral is on the first message of the thread and nowhere else. Capturing it
   turns 39% of conversations from "which model are you interested in?" into a
   direct model activation.
2. **The wa.me prefill NAMES THE MODEL, and the matcher does read it** —
   `Voyah Free 318` resolves correctly inside the prefill sentence. This opener
   should therefore activate the model and answer immediately; it is the one
   opener that arrives complete.
3. A bot that answers these three strings well answers 43% of all openers.

---

## 4. Language

Of 153 messages, as `detectLanguage()` reads them:

| Language | Msgs | % |
|---|---|---|
| English | 130 | 85% |
| Arabic script | 8 | 5% |
| Arabizi | 7 | 5% |
| French | 2 | 1% |
| Mixed / unknown | 6 | 4% |

**[Likely] The English share is inflated by the ad CTA.** Strip the 42 scripted
English strings and English falls to roughly 79%, with Arabic + Arabizi near
14%. French appears only as an opener ("Bonjour") and switches to Arabizi or
English on the next message — **nobody in this corpus held a conversation in
French**, so a French answer set is not yet justified.

**Arabizi is where the reader breaks.** Every Arabizi message longer than two
words in this corpus read as `UNKNOWN` (§6). It is 5% of messages but a much
larger share of the *substantive* ones — the Arabizi messages here ask for
price, payment method, first payment and details, i.e. exactly the 30%.

---

## 5. What staff actually answer — the real response set

Read from 131 human outbound messages. **This is the material a bot's answers
should be written from**, because it is what already works.

### 5.1 The dominant answer: one offer block, sent 60 times

Nine tenths of all substantive replies are a single pasted block with these
eight fields:

`model + year + trim` · `units remaining` · `total price incl. VAT` ·
`free maintenance period` · `in-house financing: down payment` ·
`remaining balance` · `monthly instalment × months` ·
`warranty (vehicle / battery)`

**[Certain] It answers price, down payment, instalments, VAT, maintenance and
warranty in one message — that is 5 of the 6 money topics in §2, in one send.**

**[Certain] And it is drifting, because it is retyped by hand.** Across copies
of the *same* offer the instalment term appears as **36, 37 and 38 months**.
Separately, the same MHERO II was quoted at two figures **$2,000 apart** within
the two-day window.

That is the argument for the bot, stated in the data: a template sent by a
machine cannot disagree with itself about how long a customer is paying. Three
different term lengths quoted on one offer is a dispute waiting to happen, and
today it is invisible because nothing compares outgoing messages.

### 5.2 The other answer shapes staff use

| Shape | Seen | Notes |
|---|---|---|
| **Per-model price line** | several | price incl. VAT & registration, units limited, "full option" |
| **Payment-plan menu** | 2 variants | full cash (free registration + maintenance) vs in-house loan at 0% interest, staged |
| **Model disambiguation** | 1, notable | "we have 3 models: Passion / Passion L / Passion S" — a correction the matcher should make *before* the customer is confused |
| **Trade-in intake script** | 1, reusable | asks for: photos inside and out · mileage · company-source or imported · the customer's asking price |
| **"Yes we accept trades"** | 1 | a standing policy answer |
| **Location** | 3 | Google Maps links |
| **Social handles** | 2 | the brand Instagram accounts |
| **Stock / timing** | 4 | "N units left", "sold out", "next order October", "arriving January" |
| **Greeting** | ~10 | "Hello! How may we assist you? 😊" |
| **Signature** | 3 | staff name + Monza SAL — spelt two different ways |
| **Warranty line** | 2 | vehicle years / battery years |

### 5.3 The answers customers want that NOTHING currently answers

Ranked by demand in §2, these have no template, no approved fact and no engine
action:

1. **Down payment** (12% of conversations) — always inside the offer block, never
   answerable on its own. A customer who asks only "down payment?" gets the
   whole block or a phone number.
2. **Instalment term** ("how many months for the $800") — asked repeatedly, and
   this is the field that drifts.
3. **Payment method / what is required to buy** — asked in Arabic, unanswered.
4. **VAT: included or not** — asked as "Tva?", answerable in four words.
5. **0% interest: is it real, on what** — asked directly.
6. **Trade-in** — 2 conversations opened with a bare odometer reading, which the
   reader cannot interpret at all.
7. **Which Passion / which MHERO** — the lineup genuinely confuses people.

---

## 6. Where the reader fails today — 38 of 153 messages read as UNKNOWN (25%)

Run `lib/wasales/intent.ts:readMessage()` over the corpus. Every failure below
is real and reproducible.

### 6.1 Model matching — one confident wrong answer, one asymmetric miss

Probed against the **production** catalogue (`loadCatalog()`, which merges
`CUSTOMER_WORDS`), not the seed. The flagship is fine: `Voyah Free 318`,
`318` and `free competition` all resolve to Voyah Free Comp, including inside
the wa.me prefill sentence. Courage, Dream, Taishan, Passion L and the `817` /
`917` names all match.

Two faults remain, and the first is the more serious kind.

**(a) `passion s` resolves to the plain Voyah Passion — the wrong car, with
confidence, silently.** It happened twice in two days. There is no Passion S in
the catalogue at all, so most-specific-wins has nothing to prefer and falls
back to the bare `passion` alias. Staff themselves corrected a customer in this
window that **three** Passions are sold — Passion, Passion L and Passion S —
so this is a missing *model*, not a missing alias, and adding `passion s` as an
alias of the existing Passion would make the wrong answer permanent.

**[Certain] A wrong car sent confidently is worse than no answer**: the
customer gets a brochure for a vehicle they did not ask about and no signal
that anything went wrong.

**(b) Roman numerals are asymmetric.** `mhero ii` is an alias of MHERO 2;
**`mhero i` is an alias of nothing.** So `MHERO II` matches and `MHERO I` does
not — and a customer asking about *"MHERO I and II"*, which is exactly how one
wrote it here, matches **neither**, because the two words are not consecutive.
That conversation went to a person who then quoted both cars by hand.

Add: `mhero i`, `m hero i`, `mhero-i` to MHERO 1; `m hero ii`, `mhero-ii` to
MHERO 2; and handle "X and Y" as two models rather than one failed match.

### 6.2 Arabizi, past two words

Read as `UNKNOWN`, paraphrased: *"can I get more details about the car, the
payment method, the price and the first payment"* · *"please can I ask about
the price and whether there are instalments"* · *"please we want more details"*
· *"how much is the first down payment"* · *"good morning"*.

Missing Arabizi tokens: `tafasil` / `tafasel` / `tafseel`, `daf3a`, `dafe3`,
`dfe3`, `se3a` (price, as distinct from `se3er`), `to2seet` / `ta2seet`,
`badna` / `bade` / `fiye`, `law samahto` / `plz`, `sabaho`, `adai` / `2ede`
(how much), `ofo` — and the very common `3an`, `w`, `l` as ignorable glue.

### 6.3 Arabic script gaps

Read as `UNKNOWN`, paraphrased: *"is there anything cheaper?"* (a DISCOUNT
question) · *"how is the payment done?"* (a FINANCING question) · *"what is
required for me to get the car?"* (an ELIGIBILITY question with no intent at
all in `INTENTS`).

Missing Arabic: ارخص / أرخص (cheaper), طريقة الدفع (payment method),
المطلوب (what's required), المقدم (down payment), دفعة أولى.

### 6.4 Whole categories with no intent

| Not in `INTENTS` | Evidence |
|---|---|
| **DOWN_PAYMENT** | 12% of conversations. Currently folded into PRICE or lost. |
| **INSTALMENT_TERM** | "how many months", "800 for how long" |
| **VAT_INCLUDED** | "Tva?" |
| **PAYMENT_METHOD / ELIGIBILITY** | "what is required to get the car" |
| **CAMPAIGN_OFFER** | "more info about **this offer**", "about **this deal**" — customers refer to an advert the engine has no concept of |
| **VIN / EXISTING VEHICLE** | a bare 17-char VIN. Not a sales lead at all; it belongs to service. |
| **TRADE_IN mileage** | a bare odometer figure |

**The `CAMPAIGN_OFFER` gap is structural, not a missing word.** Customers are
replying to a specific advert, and the knowledge model has only *models* and
*facts about models* — there is no object representing "the offer currently
running". Until there is, "I'm interested in this offer" cannot be answered by
anything except a human, no matter how good the lexicon gets.

### 6.5 Conversational glue with no meaning

`.` · `?` · `^` · emoji-only (👍, 👆) · "Yeah" · "Ok" · "For this one" · "Same
here" · a bare personal name. **These are answers to the previous message** and
are meaningless alone. The engine is stateless per message on this axis and
reads them all as `UNKNOWN`. A bot must treat "." and "👍" following its own
question as *continue*, not as a new enquiry.

### 6.6 Traffic that is not a customer at all

**The business number carries internal staff conversation and vendor pitches.**
In two days: a freight forwarder's sales pitch, colleagues discussing a
presentation, a request for a customer's VIN, a shared ChatGPT link, a Claude
referral link, logistics chatter ("leaving the office", "at the dentist").

`detectExclusion()` caught **one** of these — the literal word "Test". It
missed the freight pitch, which is a textbook `VENDOR_PITCH`, and it has no
notion of a colleague.

**[Certain] An autoreply widened beyond the pilot list would today answer
Monza's own staff and its suppliers with a car brochure.** That is the single
most embarrassing failure available, and it is one lexicon gap away.

---

## 7. What to build, in order of return

Ranked by (customers served) ÷ (effort). None of this is done; this section is
a recommendation, not a record.

| # | Change | Serves | Effort |
|---|---|---|---|
| 1 | **Add the Passion S as a model; add `mhero i`; match "X and Y"** | stops a confidently wrong brochure (§6.1) | trivial |
| 2 | **Capture the ad referral on the first message** and activate the model from it | 39% of conversations | small — the code already reads `referral` for leads |
| 3 | **A `CAMPAIGN_OFFER` object** — one canonical block, one source, no retyping | 30% of conversations, and kills the 36/37/38 drift | medium |
| 4 | **Money intents**: DOWN_PAYMENT, INSTALMENT_TERM, VAT_INCLUDED, PAYMENT_METHOD | 30% of conversations | small |
| 5 | **Arabizi and Arabic money vocabulary** (§6.2, §6.3) | the substantive non-English half | small |
| 6 | **Voice notes** — at minimum acknowledge and route to a person | 9% of inbound | small to acknowledge, large to transcribe |
| 7 | **Trade-in intake flow** — staff already have the script (§5.2) | 2% now, likely more | small |
| 8 | **Harden exclusions** — vendor pitches, colleagues, VINs | protects everything above | small |
| 9 | Continuation handling for ".", "ok", emoji | conversation quality | small |

**Nothing in rows 3–4 may be filled from this document.** Every figure a
customer sees is a person's decision (`knowledge.ts`: *"a fact is sent only when
approved"*). This study says **which questions need an approved answer**; it
does not supply one, and the two pricing discrepancies in §5.1 are precisely why
it must not.

---

## 8. Blind spots

- **Two days, one channel.** A Ramadan week, a launch week or a quiet week would
  each look different. The money-over-specs ratio is the claim I would defend;
  the volumes I would not.
- **This window contains a live campaign.** 60 sends of one offer block means
  the corpus is shaped by that advert. Outside a campaign the specs share
  probably rises. **[Speculative]** — there is no non-campaign window to compare.
- **Survivorship.** These are people who wrote. Nothing here tells you about the
  ones who read the ad, opened WhatsApp and closed it.
- **I did not read Instagram or Facebook text**, because it does not exist to
  read. If their mix differs, §2 is wrong for 9,115 followers' worth of traffic.
- **"Specs 7%" may be an artefact of the ad**, which already states the specs
  that matter. People do not ask what they have just been told.
- **The 46 text-less messages are unanalysed.** 23 images and 18 voice notes
  carry intent nobody has read. If the voice notes ask about money, §2's 30% is
  an undercount.
- **One conversation is Samer's own test phone**, kept in the counts because
  excluding it changes nothing material. It is the autoreply pilot's chat.
