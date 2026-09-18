/**
 * REAL CUSTOMER LANGUAGE — the adversarial suite (Samer's audit, 2026-09-18).
 *
 * "The goal is not to make the current tests pass. The goal is to make MONZA AI behave correctly
 * with real customer language." Every case is a conversation a customer could really type, run
 * through the real engine, the real workbook and the CURRENT live library. The cases are the audit's
 * own examples plus paraphrases of each — so a fix made of hard-coded sentences fails here.
 *
 * What is asserted is what the customer RECEIVES and what Sales is TOLD:
 *   - which car the bot believes is meant (never from an ordinary word)
 *   - files sent (brochures, videos) — none from a weak guess, none to an owner with a problem
 *   - the words said
 *   - alerts: at most ONE per inbound message, with every reason as a tag
 *   - the conversation state that makes the NEXT message understood
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { runConversation } from "@/lib/wasales/flow";
import { readPhone, type EngineInput } from "@/lib/wasales/engine";
import type { AlertKind, EngineAction } from "@/lib/wasales/actions";
import { MONZA_KNOWLEDGE, type SalesChannel } from "@/lib/wasales/knowledge";
import { catalog, media } from "@/tests/_current-library";
import type { OutboundPart } from "@/lib/wasales/templates";
import { classify } from "@/lib/wasales/classify";
import { readMessage } from "@/lib/wasales/intent";
import { resolveModels } from "@/lib/wasales/entities";
import { vocabularyWords } from "@/lib/wasales/intent";
import { closedByStaffReply, consolidateAlerts, mergeIntoOpen } from "@/lib/wasales/alerts";
import { triageInbound } from "@/lib/wasales/triage";

const DEPS = { knowledge: MONZA_KNOWLEDGE, catalog, media, ttlHours: 72 };
/** Thursday 17 September 2026, 12:00 in Beirut: the showroom is open. */
const THURSDAY_NOON = "2026-09-17T09:00:00.000Z";
const SUNDAY_NOON = "2026-09-20T09:00:00.000Z";
const SEND = { autoSendEnabled: true, replyWindowOpen: true, humanLock: false, liveSending: true, attachmentsSupported: true, linkOversize: true } as const;

type Msg = string | Partial<EngineInput>;
interface Opts {
  brand?: string;
  channel?: SalesChannel;
  now?: string;
}

function converse(messages: Msg[], o: Opts = {}) {
  const channel = o.channel ?? "whatsapp";
  const t0 = Date.parse(o.now ?? THURSDAY_NOON);
  const inputs: EngineInput[] = messages.map((m, i) => ({
    text: "",
    brand: o.brand ?? "monza",
    channel,
    conversationIsNew: i === 0,
    now: new Date(t0 + i * 60_000).toISOString(),
    ...(typeof m === "string" ? { text: m } : m),
  }));
  return runConversation(inputs, DEPS, { channel, ...SEND }).turns;
}
const last = (messages: Msg[], o: Opts = {}) => {
  const turns = converse(messages, o);
  return turns[turns.length - 1];
};
type Turn = ReturnType<typeof last>;

const words = (t: Turn): string =>
  t.plan
    .filter((p): p is Extract<OutboundPart, { kind: "text" }> => p.kind === "text")
    .map((p) => [p.text, ...p.choices.map((c) => c.title)].join("\n"))
    .join("\n");
const files = (t: Turn) => t.plan.filter((p) => p.kind !== "text");
const alerts = (t: Turn) => t.decision.actions.filter((a): a is Extract<EngineAction, { type: "ALERT_SALES" }> => a.type === "ALERT_SALES");
const tags = (t: Turn): AlertKind[] => alerts(t).flatMap((a) => a.tags ?? [a.kind]);
const modelOf = (t: Turn) => t.decision.understanding.model;
const namedModels = (t: Turn) => t.decision.understanding.models;
const textKeys = (t: Turn) => t.decision.actions.filter((a): a is Extract<EngineAction, { type: "SEND_TEXT" }> => a.type === "SEND_TEXT").map((a) => a.key);
const flagged = (t: Turn) => t.decision.actions.some((a) => a.type === "FLAG_FOR_STAFF");

/** No car believed, no file sent, no alert that names a car. */
function assertNoCar(t: Turn, why: string) {
  assert.equal(modelOf(t), null, `${why}: a car was believed (${modelOf(t)})`);
  assert.deepEqual(namedModels(t), [], `${why}: models named`);
  assert.equal(files(t).length, 0, `${why}: a file was sent`);
  assert.ok(alerts(t).every((a) => a.models.length === 0), `${why}: an alert names a car`);
  assert.ok(!t.decision.actions.some((a) => a.type === "SHOW_COLOUR_CHOICES" || a.type === "SEND_COLOUR_VIDEO" || a.type === "SEND_BROCHURE"), `${why}: model material`);
}

const NO_MONEY = [/\$/, /\bUSD\b/i, /\bLBP\b/i, /\bdollars?\b/i, /\bprice is\b/i, /\bcosts?\s+\d/i];

/* ═════════════════════════ PHASE 1 · ordinary words are never models ═════════════════════════ */

describe("Phase 1 — an ordinary word is never a car", () => {
  const ORDINARY: string[] = [
    // The audit's own five.
    "It's my dream car",
    "Cars are my passion",
    "Is the first service free?",
    "Courage to ask: what's the discount",
    "I need a person",
    // Paraphrases — the fix must be a rule, not a list of sentences.
    "this has always been my dream",
    "owning an electric suv is a dream of mine",
    "my dream car is something big and comfortable",
    "i dream of driving one",
    "I have a passion for cars",
    "driving is my passion",
    "you guys work with passion",
    "is delivery free?",
    "is registration free",
    "are you free tomorrow at 5?",
    "I am free now, call me",
    "feel free to message me anytime",
    "do I get free charging?",
    "free maintenance included?",
    "it takes courage to ask about the discount",
    "I finally had the courage to message you",
    "can a person call me",
    "is there a person I can talk to",
    "personal question, are you hiring?",
  ];
  for (const text of ORDINARY) {
    test(`"${text}" names no car, sends no file`, () => assertNoCar(last([text]), text));
  }

  const REAL: [string, string][] = [
    ["Voyah Dream", "DREAM"],
    ["Dream price", "DREAM"],
    ["the Dream", "DREAM"],
    ["price of the dream", "DREAM"],
    ["i like the dream", "DREAM"],
    ["dream brochure please", "DREAM"],
    ["MHERO 1", "MHERO_1"],
    ["Courage range", "COURAGE"],
    ["how much is the courage", "COURAGE"],
    ["courage black", "COURAGE"],
    ["Free 318", "FREE_318"],
    ["do you have the free in stock", "FREE_318"],
    ["voyah free", "FREE_318"],
    ["the free", "FREE_318"],
    ["Taishan", "TAISHAN"],
    ["passion", "PASSION"],
    ["the passion in black", "PASSION"],
    ["passion l", "PASSION_L"],
    ["كوراج", "COURAGE"],
    ["سعر الدريم", "DREAM"],
  ];
  for (const [text, code] of REAL) {
    test(`"${text}" IS the ${code}`, () => {
      const t = last([text]);
      assert.equal(modelOf(t), code, text);
      assert.ok(t.decision.understanding.modelEvidence.length > 0, "the resolver says why");
    });
  }

  test("a weak match is ASKED — 'Did you mean…?' — and nothing is sent or alerted", () => {
    for (const text of ["dream is nice", "passion looks good honestly"]) {
      const t = last([text]);
      assert.equal(modelOf(t), null, text);
      assert.ok(t.decision.understanding.weakModels.length === 1, text);
      assert.match(words(t), /Did you mean the VOYAH (Dream|Passion)\?/, text);
      assert.equal(files(t).length, 0, text);
      assert.equal(alerts(t).length, 0, text);
      assert.equal(t.decision.nextState.awaiting, "CONFIRM_MODEL");
    }
  });

  test("'yes' to 'Did you mean the Dream?' is the Dream; 'no' asks which model", () => {
    const yes = last(["dream is nice", "yes"]);
    assert.equal(yes.decision.nextState.activeModel, "DREAM");
    assert.ok(files(yes).length >= 1, "now — and only now — its material goes");
    const no = last(["dream is nice", "no"]);
    assert.equal(no.decision.nextState.activeModel, null);
    assert.match(words(no), /Which model are you interested in\?/);
    assert.equal(files(no).length, 0);
  });

  test("the resolver returns confidence and evidence, and says why a word was dismissed", () => {
    const v = vocabularyWords();
    const ctx = { offeredCarIds: [], discussedCarIds: [], adCarId: null, intentWords: v.single, carTalkWords: v.carTalk };
    const dream = resolveModels("it's my dream car", catalog, ctx);
    assert.equal(dream.mentions.length, 0);
    assert.match(dream.rejected[0].reason, /ordinary English/);
    const person = resolveModels("i need a person", catalog, ctx);
    assert.equal(person.mentions.length, 0);
    const strong = resolveModels("voyah dream", catalog, ctx);
    assert.equal(strong.mentions[0].confidence, "strong");
    // The conversation is evidence: the same word, while the Dream is being discussed or was just offered.
    const dreamId = strong.mentions[0].carId;
    assert.equal(resolveModels("dream is nice", catalog, ctx).mentions[0].confidence, "weak");
    assert.equal(resolveModels("dream is nice", catalog, { ...ctx, discussedCarIds: [dreamId] }).mentions[0].confidence, "strong");
    assert.equal(resolveModels("dream is nice", catalog, { ...ctx, adCarId: dreamId }).mentions[0].confidence, "strong");
  });
});

/* ═════════════════════════ PHASE 2 · the bot understands answers to its own questions ═════════ */

describe("Phase 2 — multi-turn state", () => {
  test("'Courage' → 'price' → 'and the Taishan?' is the PRICE flow for the Taishan", () => {
    for (const follow of ["and the Taishan?", "same for Taishan", "what about the taishan", "and for the taishan"]) {
      const t = last(["Courage", "price", follow]);
      assert.equal(modelOf(t), "TAISHAN", follow);
      assert.ok(textKeys(t).includes("PRICE_HANDOFF"), follow);
      assert.deepEqual(tags(t), ["PRICE"], follow);
      assert.deepEqual(alerts(t)[0].models, ["TAISHAN"], follow);
      for (const re of NO_MONEY) assert.doesNotMatch(words(t), re);
    }
  });

  test("the carried question is whatever was asked last — range, colours, stock", () => {
    const range = last(["courage", "range?", "and the dream?"]);
    assert.match(words(range), /VOYAH Dream offers 185 km EV/);
    const stock = last(["courage", "do you have it in stock", "and the taishan?"]);
    assert.deepEqual(tags(stock), ["STOCK"]);
  });

  test("'Courage' → 'Dream' → 'which has more range?' compares the Courage and the Dream", () => {
    for (const q of ["which has more range?", "which one has more range", "which is faster?", "compare them"]) {
      const t = last(["Courage", "Dream", q]);
      const cmp = t.decision.actions.find((a) => a.type === "SEND_COMPARISON");
      assert.ok(cmp && cmp.type === "SEND_COMPARISON", q);
      if (cmp && cmp.type === "SEND_COMPARISON") assert.deepEqual([...cmp.models].sort(), ["COURAGE", "DREAM"], q);
    }
  });

  test("a requested SUNDAY: Monza is closed, another day is asked — never 'noted'", () => {
    for (const msgs of [["courage", "test drive on sunday"], ["courage", "test drive", "sunday at 11"], ["courage", "test drive", "sunday"]]) {
      const t = last(msgs);
      assert.match(words(t), /closed on Sundays/, msgs.join(" › "));
      assert.match(words(t), /Which other day/, msgs.join(" › "));
      assert.doesNotMatch(words(t), /I've noted|I've passed/, msgs.join(" › "));
      assert.equal(alerts(t)[0]?.slot ?? null, null, "no Sunday slot is passed to Sales");
    }
  });

  test("'tomorrow' then 'at 4' is tomorrow at 4 — the day is remembered", () => {
    const turns = converse(["courage", "test drive", "tomorrow", "at 4"]);
    assert.match(words(turns[2]), /Noted, Fri 18 Sep\. What time would suit you\?/);
    assert.equal(turns[2].decision.nextState.pendingDay, "2026-09-18");
    assert.match(words(turns[3]), /passed Fri 18 Sep, 16:00/);
    assert.equal(turns[3].decision.nextState.pendingDay, null);
    assert.equal(alerts(turns[3])[0].slot, "2026-09-18T13:00:00.000Z");
  });

  test("a time outside opening hours asks for another time", () => {
    const t = last(["courage", "test drive", "saturday at 5pm"]);
    assert.match(words(t), /Which time within those hours/);
    assert.equal(alerts(t)[0]?.slot ?? null, null);
  });

  test("two cars in play + 'black': asks WHICH car — then sends that car in black", () => {
    const turns = converse(["courage and dream", "black", "VOYAH Courage"]);
    assert.match(words(turns[1]), /Which car would you like to see in .*black/i);
    assert.equal(files(turns[1]).length, 0);
    assert.equal(turns[1].decision.nextState.awaiting, "COLOUR_OF_WHICH");
    const video = turns[2].decision.actions.find((a) => a.type === "SEND_COLOUR_VIDEO");
    assert.ok(video && video.type === "SEND_COLOUR_VIDEO" && video.model === "COURAGE" && video.colour === "pearl-black");
  });

  test("trade-in: the photo is the trade-in's; 'how much will you give me?' is a valuation", () => {
    const photo = last(["trade in", { text: "", hasMedia: true }]);
    assert.deepEqual(textKeys(photo), ["TRADE_IN_PHOTO_THANKS"]);
    assert.deepEqual(tags(photo), ["TRADE_IN"]);
    assert.equal(photo.decision.nextState.tradeInPhotos, 1);
    for (const q of ["how much will you give me?", "what's it worth?", "how much is my car worth"]) {
      const t = last(["trade in", "bmw x5 2019 80000 km", q]);
      assert.deepEqual(textKeys(t), ["TRADE_IN_VALUATION"], q);
      assert.deepEqual(tags(t), ["TRADE_IN"], q);
      assert.doesNotMatch(words(t), /VOYAH and MHERO/, "never the 'we specialise in' sentence");
      for (const re of NO_MONEY) assert.doesNotMatch(words(t), re);
    }
    // A photo with no trade-in in progress goes to a person: acknowledged, never read, never filed as a trade-in.
    const plain = last([{ text: "", hasMedia: true }]);
    assert.deepEqual(textKeys(plain), ["PHOTO_RECEIVED"]);
    assert.deepEqual(tags(plain), ["NEEDS_PERSON"]);
    assert.equal(plain.decision.nextState.tradeInPhotos, 0);
  });

  test("'Courage' → 'Courage' is never silence", () => {
    const t = last(["Courage", "Courage"]);
    assert.ok(t.plan.length > 0);
    assert.match(words(t), /VOYAH Courage/);
    assert.equal(files(t).length, 0, "and never the brochure a second time");
  });

  test("yes / yes please / sure / send it / okay answer the pending question; no / no thanks decline it", () => {
    for (const yes of ["yes", "yes please", "sure", "send it", "okay", "ok", "اي", "oui"]) {
      const t = last(["what EVs do you have", yes]);
      assert.equal(t.decision.nextState.activeModel, "COURAGE", `"${yes}" to "Would you like to see it?"`);
    }
    for (const no of ["no", "no thanks", "not now", "لا"]) {
      const t = last(["what EVs do you have", no]);
      assert.equal(t.decision.nextState.activeModel, null, no);
      assert.equal(files(t).length, 0, no);
      assert.equal(alerts(t).length, 0, `"${no}" raises nobody`);
    }
    // A bare yes with no question open is not a question: nothing, and nobody is called.
    const stray = last(["where are you located", "yes"]);
    assert.equal(stray.plan.length, 0);
    assert.equal(alerts(stray).length, 0);
  });

  test("'yes' to the colour question sends a video; 'no' drops the question", () => {
    const yes = last(["courage", "yes"]);
    assert.ok(yes.decision.actions.some((a) => a.type === "SEND_COLOUR_VIDEO"));
    const no = last(["courage", "no thanks"]);
    assert.equal(files(no).length, 0);
    assert.equal(no.decision.nextState.awaiting, "NONE");
  });
});

/* ═════════════════════════ negative commands and preferences ═════════════════════════ */

describe("negative commands are obeyed, and remembered for the conversation", () => {
  test("'No video please': no video now, none later — until the customer asks for one", () => {
    const turns = converse(["courage", "No video please", "price", "dream", "send me the video"]);
    assert.equal(turns[1].decision.nextState.noVideo, true);
    assert.match(words(turns[1]), /won't send you the video/);
    assert.ok(!turns[2].decision.actions.some((a) => a.type === "SEND_COLOUR_VIDEO"), "the price flow sends no video");
    assert.deepEqual(tags(turns[2]), ["PRICE"]);
    assert.ok(!turns[3].decision.actions.some((a) => a.type === "SEND_COLOUR_VIDEO" || a.type === "SHOW_COLOUR_CHOICES"), "a new car: still no video");
    assert.ok(turns[4].decision.actions.some((a) => a.type === "SEND_COLOUR_VIDEO"), "asked for: sent");
    assert.equal(turns[4].decision.nextState.noVideo, false);
  });

  test("'I don't want the brochure': never sent, for any car — until asked for", () => {
    for (const refusal of ["I don't want the brochure", "no brochure please", "don't send the brochure"]) {
      const turns = converse([refusal, "courage", "taishan", "ok send me the brochure"]);
      assert.equal(turns[0].decision.nextState.noBrochure, true, refusal);
      assert.ok(!turns[1].decision.actions.some((a) => a.type === "SEND_BROCHURE"), refusal);
      assert.ok(!turns[2].decision.actions.some((a) => a.type === "SEND_BROCHURE"), refusal);
      assert.ok(turns[3].decision.actions.some((a) => a.type === "SEND_BROCHURE"), refusal);
    }
  });

  test("'Not interested', 'stop', 'wrong number': acknowledged; no material, no menu, no alert, no push", () => {
    for (const [text, key] of [
      ["Not interested", "NOT_INTERESTED_ACK"],
      ["no longer interested thanks", "NOT_INTERESTED_ACK"],
      ["stop messaging me", "OPT_OUT_ACK"],
      ["unsubscribe", "OPT_OUT_ACK"],
      ["Wrong number", "WRONG_NUMBER_ACK"],
      ["sorry wrong number", "WRONG_NUMBER_ACK"],
      ["مش مهتم", "NOT_INTERESTED_ACK"],
    ] as const) {
      const t = last(["courage", text]);
      assert.deepEqual(textKeys(t), [key], text);
      assert.equal(files(t).length, 0, text);
      assert.equal(alerts(t).length, 0, text);
      assert.doesNotMatch(words(t), /70 70 85 85/, `${text}: never the sales number`);
      assert.equal(t.decision.nextState.notInterested, true, text);
    }
    // …and what they write next is not chased with a hand-off; a real question is still answered.
    assert.equal(last(["not interested", "ok"]).plan.length, 0);
    assert.match(words(last(["not interested", "actually what's the courage range"])), /550 km/);
  });
});

/* ═════════════════════════ PHASE 3 + 9 · buying intent, ONE alert ═════════════════════════ */

describe("Phase 3 / 9 — buying intent, and exactly one alert per message", () => {
  test("buying intent raises ONE hot alert", () => {
    for (const text of ["I want to buy the Courage", "reserve a courage for me", "courage — I'll take it", "can you hold a courage for me?", "I'm ready to purchase the courage", "bade eshtere courage", "بدي اشتري الكوراج", "أريد حجز الكوراج"]) {
      const t = last([text]);
      assert.equal(alerts(t).length, 1, text);
      assert.equal(alerts(t)[0].kind, "BUYING", text);
      assert.equal(alerts(t)[0].urgency, "hot", text);
      assert.deepEqual(alerts(t)[0].models, ["COURAGE"], text);
      for (const re of NO_MONEY) assert.doesNotMatch(words(t), re);
    }
  });

  test("buying intent with no car: the alert goes at once, and the car is asked", () => {
    for (const text of ["I'll take it", "I want one", "how do I buy it?", "reserve one for me", "ready to purchase"]) {
      const t = last([text]);
      assert.deepEqual(tags(t), ["BUYING"], text);
      assert.match(words(t), /Which model/, text);
    }
    const then = last(["I want one", "VOYAH Taishan"]);
    assert.deepEqual(tags(then), ["BUYING"]);
    assert.deepEqual(alerts(then)[0].models, ["TAISHAN"]);
  });

  test("the audit's message: ONE consolidated alert — model, buying, stock, financing, test drive, the day", () => {
    const t = last(["I want the Courage, do you have stock, can I finance it and test drive tomorrow?"]);
    assert.equal(alerts(t).length, 1);
    const a = alerts(t)[0];
    assert.equal(a.kind, "BUYING");
    assert.deepEqual(a.tags, ["BUYING", "TEST_DRIVE", "FINANCING", "STOCK"]);
    assert.deepEqual(a.models, ["COURAGE"]);
    assert.match(a.reason ?? "", /Fri 18 Sep/, "the requested day reaches Sales");
    assert.equal(a.urgency, "qualified", "'I want the Courage' is qualified interest; 'I'll take it' is hot");
    // One question per reply: the time is asked, the colour waits.
    assert.equal((words(t).match(/\?/g) ?? []).length, 1, words(t));
  });

  test("no message of any kind ever raises more than one alert", () => {
    const busy = [
      "courage price, installments, warranty and test drive?",
      "taishan price and discount and do you have it in stock and can i trade in my car",
      "I want to buy the dream, call me, and I want a test drive saturday at 11",
      "hello i have been waiting since yesterday for the price of the courage",
      "talk to a human about the price of the free",
    ];
    for (const text of busy) assert.ok(alerts(last([text])).length <= 1, text);
  });

  test("consolidateAlerts / mergeIntoOpen / closedByStaffReply (the rules)", () => {
    const mk = (kind: AlertKind, reason?: string): EngineAction => ({ type: "ALERT_SALES", kind, models: ["COURAGE"], name: null, phone: null, slot: null, ...(reason ? { reason } : {}) });
    const one = consolidateAlerts([mk("PRICE"), mk("STOCK"), mk("BUYING", "Reservation request"), mk("LEAD")]).filter((a) => a.type === "ALERT_SALES");
    assert.equal(one.length, 1);
    if (one[0].type === "ALERT_SALES") {
      assert.deepEqual(one[0].tags, ["BUYING", "PRICE", "STOCK"], "a LEAD adds nothing once a real reason is known");
      assert.equal(one[0].urgency, "hot");
      assert.match(one[0].reason ?? "", /^Reservation request · Price · Stock$/);
    }
    // A chat keeps ONE open alert: the next message's reasons are added, and it is escalated.
    const open = { kind: "PRICE" as AlertKind, tags: ["PRICE" as AlertKind], urgency: "qualified" as const, models: ["COURAGE"], customer_name: null, customer_phone: null, slot_at: null, reason: "Price" };
    const merged = mergeIntoOpen(open, { kind: "OVERDUE", models: ["COURAGE"], name: null, phone: null, slot: null, reason: "Says they have been waiting" });
    assert.equal(merged.changed, true);
    assert.equal(merged.row.kind, "OVERDUE");
    assert.deepEqual(merged.row.tags, ["OVERDUE", "PRICE"]);
    assert.equal(merged.row.urgency, "overdue");
    assert.equal(mergeIntoOpen(open, { kind: "PRICE", models: ["COURAGE"], name: null, phone: null, slot: null, reason: "Price" }).changed, false, "the same question twice is one follow-up");
    // A person replied after the alert: closed — except the work a reply does not finish.
    const raised = "2026-09-17T09:00:00.000Z";
    assert.equal(closedByStaffReply({ kind: "PRICE", created_at: raised }, "2026-09-17T09:30:00.000Z"), true);
    assert.equal(closedByStaffReply({ kind: "PRICE", created_at: raised }, "2026-09-17T08:00:00.000Z"), false, "a reply BEFORE the alert answers nothing");
    assert.equal(closedByStaffReply({ kind: "PRICE", created_at: raised }, null), false);
    for (const manual of ["BUYING", "CALLBACK", "TEST_DRIVE", "TRADE_IN"] as const) {
      assert.equal(closedByStaffReply({ kind: manual, created_at: raised }, "2026-09-17T10:00:00.000Z"), false, manual);
    }
    assert.equal(closedByStaffReply({ kind: "PRICE", tags: ["PRICE", "TEST_DRIVE"], created_at: raised }, "2026-09-17T10:00:00.000Z"), false);
  });

  test("outside the pilot, a message is marked ONCE with every reason (triage)", () => {
    const t = triageInbound({ text: "I want to buy the courage, is it in stock, and can I pay monthly?", hasMedia: false, brand: "monza", now: THURSDAY_NOON }, DEPS);
    assert.ok(t);
    assert.equal(t?.kind, "BUYING");
    assert.deepEqual(t?.tags, ["BUYING", "FINANCING", "STOCK"]);
    assert.equal(t?.urgency, "hot");
    const waiting = triageInbound({ text: "nobody answered me since yesterday", hasMedia: false, brand: "monza", now: THURSDAY_NOON }, DEPS);
    assert.equal(waiting?.kind, "OVERDUE");
    assert.equal(waiting?.urgency, "overdue");
  });
});

/* ═════════════════════════ PHASE 4 · the ad is soft context ═════════════════════════ */

describe("Phase 4 — the ad the customer came from", () => {
  const fromCourageAd = { referral: { headline: "Voyah COURAGE" } };

  test("Courage ad + 'how much is it?' is the Courage — never 'which model?'", () => {
    for (const q of ["how much is it?", "price?", "what's the range", "is it available", "can I test drive it"]) {
      const t = last([{ text: q, ...fromCourageAd }]);
      assert.equal(modelOf(t), "COURAGE", q);
      assert.equal(t.decision.understanding.modelSource, "ad", q);
      assert.doesNotMatch(words(t), /Which model are you interested in/, q);
    }
  });

  test("the ad is kept for later messages, and is never a lock", () => {
    const turns = converse([{ text: "hi", ...fromCourageAd }, "how much is it?", "Actually I'm interested in the Dream", "how much is it?"]);
    assert.equal(turns[0].decision.nextState.adModel, "COURAGE");
    assert.equal(files(turns[0]).length, 0, "a greeting from an ad is greeted — no brochure is pushed");
    assert.equal(modelOf(turns[1]), "COURAGE");
    assert.equal(modelOf(turns[2]), "DREAM");
    assert.equal(modelOf(turns[3]), "DREAM", "the car being discussed beats the ad");
    assert.deepEqual(alerts(turns[3])[0].models, ["DREAM"]);
  });

  test("an explicit car in the message beats the ad; a question needing no car ignores it", () => {
    assert.equal(modelOf(last([{ text: "how much is the taishan", ...fromCourageAd }])), "TAISHAN");
    const where = last([{ text: "where are you located?", ...fromCourageAd }]);
    assert.equal(modelOf(where), null);
    assert.equal(files(where).length, 0);
    // An ad headline that names no single car is no context at all.
    assert.equal(last([{ text: "how much is it?", referral: { headline: "Monza S.A.L. — new arrivals" } }]).decision.nextState.adModel, null);
    // Another brand's ad on this account is ignored (rule 1: the account decides the brand).
    assert.equal(last([{ text: "how much is it?", referral: { headline: "Voyah COURAGE" } }], { brand: "mhero" }).decision.nextState.adModel, null);
  });
});

/* ═════════════════════════ PHASE 5 · the question, not the keyword ═════════════════════════ */

describe("Phase 5 — intent routing before spec keywords", () => {
  test("classify(): qualifiers beat topic words, and says why", () => {
    const of = (text: string) => classify(readMessage(text, null).intents);
    assert.deepEqual(of("is the battery safe?").intents, ["SAFETY"]);
    assert.deepEqual(of("battery life, how many years?").intents, ["BATTERY_LIFE"]);
    assert.deepEqual(of("How much does charging cost?").intents, ["CHARGING_COST"]);
    assert.deepEqual(of("what is the price of charging").intents, ["CHARGING_COST"]);
    assert.deepEqual(of("battery replacement cost").intents, ["BATTERY_REPLACEMENT"]);
    assert.deepEqual(of("how much is a new battery").intents, ["BATTERY_REPLACEMENT"]);
    assert.equal(of("battery replacement cost").ownerSupport, true);
    assert.deepEqual(of("how long is the warranty on the battery").intents, ["WARRANTY"]);
    assert.deepEqual(of("i want to trade in my bmw x5 2019 120000 km").intents, ["TRADE_IN"]);
    assert.ok(of("is the battery safe?").dropped.some((d) => d.intent === "BATTERY" && /safety/.test(d.because)));
  });

  test("battery: safety · lifespan · replacement are three different answers — none of them kWh", () => {
    for (const text of ["Is the battery safe?", "can the battery catch fire", "is it safe in an accident"]) {
      const t = last(["courage", text]);
      assert.doesNotMatch(words(t), /kWh/, text);
      assert.doesNotMatch(words(t), /\bsafe\b|fire|no risk/i, `${text}: the bot says nothing about safety itself`);
      assert.ok(tags(t).includes("NEEDS_PERSON"), text);
    }
    for (const text of ["battery life, how many years?", "how long does the battery last", "battery lifespan?"]) {
      const t = last(["courage", text]);
      assert.doesNotMatch(words(t), /kWh/, text);
      assert.match(words(t), /10 years on the battery/, text);
      assert.match(words(t), /lifespan beyond the warranty is not in our approved information/, text);
    }
    for (const text of ["battery replacement cost", "how much to replace the battery", "how much is a new battery"]) {
      const t = last(["courage", text]);
      assert.match(words(t), /76 877 278/, text);
      assert.doesNotMatch(words(t), /kWh|Sales Team will assist/, `${text}: a service question, never the price flow`);
      assert.ok(!tags(t).includes("PRICE"), text);
    }
  });

  test("charging: time · charger · home · public · cost are five different answers", () => {
    const cases: [string, RegExp][] = [
      ["do you give a charger?", /charger supplied with the car/],
      ["does it come with a charger", /charger supplied with the car/],
      ["can I charge at home?", /home charging/],
      ["do I need a wallbox at home", /home charging/],
      ["Where can I charge in Lebanon?", /public charging in Lebanon/],
      ["are there charging stations in beirut", /public charging in Lebanon/],
      ["How much does charging cost?", /charging costs/],
      ["how much to charge it fully", /charging costs/],
    ];
    for (const [text, expected] of cases) {
      const t = last(["courage", text]);
      assert.match(words(t), expected, text);
      assert.ok(!tags(t).includes("PRICE"), `${text}: never the vehicle-price flow`);
      assert.ok(!textKeys(t).includes("PRICE_HANDOFF"), text);
      assert.equal(files(t).length, 0, text);
      assert.deepEqual(tags(t), ["QUESTION"], text);
    }
    // The charging TIME is still the workbook's own fact.
    assert.match(words(last(["courage", "how long to charge"])), /approved charging information/);
  });

  test("'Will it fit in my garage?' is dimensions; brand origin is not the showroom's address", () => {
    assert.match(words(last(["courage", "Will it fit in my garage?"])), /4,725 × 1,900 × 1,650 mm/);
    for (const text of ["Where is Voyah from?", "Who makes Voyah?", "is voyah chinese", "which country is mhero from"]) {
      const t = last([text]);
      assert.match(words(t), /where the brand comes from and who makes it/, text);
      assert.doesNotMatch(words(t), /Horch Tabet/, text);
      assert.doesNotMatch(words(t), /Which (one|model)/, `${text}: not a wish to pick a model`);
    }
  });

  test("an OWNER with a problem gets Service — never a brochure, colours, a video or a sales alert", () => {
    for (const text of [
      "I own a Voyah Free and the screen is frozen",
      "my courage won't start",
      "i bought a dream last year and there is a warning light",
      "My warranty claim",
      "i need a spare key for my courage",
      "software update for my free",
      "my taishan is making a noise",
      "سيارتي الكوراج معطلة",
    ]) {
      const t = last([text]);
      assert.match(words(t), /76 877 278|واتساب/, text);
      assert.equal(files(t).length, 0, text);
      assert.ok(!t.decision.actions.some((a) => a.type === "SHOW_COLOUR_CHOICES" || a.type === "SHOW_MODEL_CHOICES"), text);
      assert.equal(alerts(t).length, 0, `${text}: not a sales alert`);
      assert.ok(flagged(t), `${text}: staff are flagged`);
      assert.equal(t.decision.nextState.activeModel, null, `${text}: no sales conversation is opened`);
      assert.doesNotMatch(words(t), /70 70 85 85/, text);
    }
  });

  test("after-sales words go to 76 877 278, not Sales — also with a car named", () => {
    for (const text of ["I need a service for my courage", "maintenance appointment", "spare parts for the free", "repair", "technical issue with my car"]) {
      const t = last([text]);
      assert.match(words(t), /76 877 278/, text);
      assert.equal(files(t).length, 0, text);
    }
  });
});

/* ═════════════════════════ PHASE 6 · trade-in and selling a car ═════════════════════════ */

describe("Phase 6 — trade-in / sell-my-car", () => {
  test("every way of saying it opens the trade-in steps — never 'we specialise in VOYAH and MHERO'", () => {
    for (const text of [
      "trade in", "can I exchange my car", "swap my car", "I have a car to exchange", "do you buy cars?", "can I sell you my car?",
      "will you take my old car", "I want a valuation for my car", "how much is my car worth?", "i want to trade in my bmw", "بدي بدل سيارتي",
    ]) {
      const t = last([text]);
      assert.ok(textKeys(t).includes("TRADE_IN_INFO") || textKeys(t).includes("TRADE_IN_THANKS"), `${text} → ${textKeys(t).join(",")}`);
      assert.doesNotMatch(words(t), /specialize in VOYAH and MHERO/, text);
      assert.equal(t.decision.nextState.tradeIn, true, text);
      for (const re of NO_MONEY) assert.doesNotMatch(words(t), re);
    }
  });
  test("'what brands do you sell' still gets the brands sentence", () => {
    assert.match(words(last(["do you sell bmw?"])), /specialize in VOYAH and MHERO/);
  });
});

/* ═════════════════════════ PHASE 8 · phone numbers ═════════════════════════ */

describe("Phase 8 — Lebanese phone numbers", () => {
  test("every way a Lebanese number is typed is one form; a foreign number is never rewritten", () => {
    for (const [typed, expected] of [
      ["71222333", "96171222333"],
      ["71 222 333", "96171222333"],
      ["03 123 456", "9613123456"],
      ["03123456", "9613123456"],
      ["+961 71 222 333", "96171222333"],
      ["0096171222333", "96171222333"],
      ["+96103123456", "9613123456"],
      ["81 659 640", "96181659640"],
      ["+44 7911 123456", "447911123456"],
      ["+971 50 123 4567", "971501234567"],
      ["0033612345678", "33612345678"],
    ] as const) {
      assert.equal(readPhone(`call me on ${typed} please`), expected, typed);
    }
    assert.equal(readPhone("the courage has 430 hp"), null);
  });
  test("the number is read back in the international form", () => {
    assert.match(words(last(["call me on 71222333"], { channel: "instagram" })), /\+96171222333/);
  });
});

/* ═════════════════════════ PHASES 11–17 ═════════════════════════ */

describe("Phases 11–17 — financing words, visits, recommendations, waiting, greetings", () => {
  test("every financing wording is the financing flow — with no price and no term", () => {
    for (const text of [
      "financing?", "finance", "bank finance", "car loan", "monthly payments", "can I pay monthly", "installments", "instalments", "payment plan",
      "can I pay over 5 years", "60 months", "تقسيط", "تمويل", "دفعات", "قرض", "fi ta2sit?", "bel ta2sit",
    ]) {
      const t = last([text]);
      assert.ok(textKeys(t).includes("FINANCING_INFO"), `${text} → ${textKeys(t).join(",")}`);
      assert.deepEqual(tags(t), ["FINANCING"], text);
      for (const re of [...NO_MONEY, /\d+\s?%/, /\bper month\b/i, /\d+\s?(months|years)/i]) assert.doesNotMatch(words(t), re, text);
    }
  });

  test("a visit: welcomed with the address and hours — unless Monza is closed then", () => {
    for (const text of ["I want to come see the car", "can I visit?", "showroom visit", "I'd like to see it in person", "can I pass by tomorrow"]) {
      const t = last([text]);
      assert.deepEqual(textKeys(t), ["VISIT_WELCOME"], text);
      assert.match(words(t), /Horch Tabet/, text);
      assert.match(words(t), /maps\.app\.goo\.gl\/CVPJQqXfnnbBmubZ8/, text);
      assert.deepEqual(tags(t), ["VISIT"], text);
    }
    assert.match(words(last(["can I pass by tomorrow"])), /expect you on Fri 18 Sep/);
    for (const [msgs, now] of [[["can I come today?"], SUNDAY_NOON], [["can i visit on sunday"], THURSDAY_NOON], [["can I pass by tomorrow"], "2026-09-19T09:00:00.000Z"]] as const) {
      const t = last([...msgs], { now });
      assert.match(words(t), /closed on Sundays/, msgs.join());
      assert.doesNotMatch(words(t), /most welcome/, msgs.join());
      assert.equal((words(t).match(/Monday to Friday/g) ?? []).length, 1, "the hours are said once");
    }
  });

  test("'we're closed on Sundays — which other day?' → 'monday then, at 10' is still the visit", () => {
    const turns = converse(["can I pass by tomorrow?", "monday then, at 10"], { now: "2026-09-19T09:00:00.000Z" });
    assert.equal(turns[0].decision.nextState.pendingVisit, true);
    assert.deepEqual(textKeys(turns[1]), ["VISIT_WELCOME"]);
    assert.match(words(turns[1]), /expect you on Mon 21 Sep, 10:00/);
    assert.deepEqual(tags(turns[1]), ["VISIT"]);
    assert.equal(alerts(turns[1])[0].slot, "2026-09-21T07:00:00.000Z");
    assert.equal(turns[1].decision.nextState.pendingVisit, false);
  });

  test("recommendations come from the workbook's columns, are listed, and never say 'best'", () => {
    const fastest = last(["which is your fastest car"]);
    assert.match(words(fastest), /MHERO 1 — 815 hp/);
    const family = last(["I need a family car"]);
    assert.match(words(family), /VOYAH Dream — 7/);
    for (const text of ["which is your fastest car", "I need a family car", "biggest car you have", "longest range?", "something for off road", "what's the most luxurious", "I want an suv", "what do you recommend"]) {
      const t = last([text]);
      assert.ok(t.plan.length > 0, text);
      assert.doesNotMatch(words(t), /\bbest\b|\bwe recommend the\b|\bperfect for you\b/i, text);
      assert.equal(files(t).length, 0, text);
    }
    for (const text of ["my budget is 40k what do you recommend", "what's your cheapest car", "something affordable"]) {
      const t = last([text]);
      for (const re of NO_MONEY) assert.doesNotMatch(words(t), re, text);
      assert.doesNotMatch(words(t), /40/, `${text}: the customer's figure is never repeated`);
      assert.ok(tags(t).length === 1, text);
    }
  });

  test("'I've been waiting since yesterday' is an apology and an OVERDUE alert", () => {
    for (const text of ["I've been waiting since yesterday", "nobody answered", "I messaged hours ago", "still waiting", "no one called me", "ما حدا رد علي"]) {
      const t = last(["courage", "price", text]);
      assert.deepEqual(textKeys(t), ["WAITING_APOLOGY"], text);
      assert.equal(alerts(t).length, 1, text);
      assert.equal(alerts(t)[0].kind, "OVERDUE", text);
      assert.equal(alerts(t)[0].urgency, "overdue", text);
    }
  });

  test("hello / hi / anyone? / ? / مرحبا / bonjour: a welcome, never silence, never a salesperson", () => {
    for (const text of ["hello", "hi", "anyone?", "?", "مرحبا", "bonjour", "hey there", "good morning"]) {
      const t = last([text]);
      assert.ok(t.plan.length > 0, `${text}: silence`);
      assert.equal(alerts(t).length, 0, `${text}: no alert for a greeting`);
      assert.equal(files(t).length, 0, text);
    }
    // In the middle of a chat, "?" is a nudge — still no salesperson.
    const nudge = last(["courage", "?"]);
    assert.deepEqual(textKeys(nudge), ["NUDGE"]);
    assert.equal(alerts(nudge).length, 0);
  });

  test("contact channels, features: a controlled hand-off — nothing invented", () => {
    for (const text of ["what's your email?", "do you have a website", "what's your instagram", "does it have carplay", "does the courage have a sunroof"]) {
      const t = last([text]);
      assert.doesNotMatch(words(t), /@|\.com|www\.|instagram\.com/i, `${text}: no address is invented`);
      assert.match(words(t), /Sales Team can confirm it with you right here/, text);
      assert.deepEqual(tags(t), ["QUESTION"], text);
    }
    assert.match(words(last(["are you open now?"])), /Monday to Friday/);
  });
});

/* ═════════════════════════ PHASE 18 · languages and typos ═════════════════════════ */

describe("Phase 18 — Arabic, Lebanese Arabizi, French, typos", () => {
  test("Arabizi", () => {
    assert.match(words(last(["3andkon siyarat kahraba?"])), /fully electric driving.*VOYAH Courage/s);
    assert.deepEqual(tags(last(["bade 7ada ye7kine"])), ["HUMAN"]);
    assert.deepEqual(tags(last(["adde se3er el courage"])), ["PRICE"]);
    assert.equal(modelOf(last(["bade shuf el taishan"])), "TAISHAN");
  });

  test("typos", () => {
    const t = last(["free318 rnge"]);
    assert.equal(modelOf(t), "FREE_318");
    assert.match(words(t), /318 km EV/);
    assert.equal(modelOf(last(["corage prise"])), "COURAGE");
    assert.deepEqual(tags(last(["corage prise"])), ["PRICE"]);
    assert.equal(modelOf(last(["tayshan waranty"])), "TAISHAN");
  });

  test("an Arabic colour question is COLOURS — never STOCK", () => {
    for (const text of ["شو الالوان المتوفرة للكوراج", "الالوان الموجودة للكوراج", "كوراج شو الوانها"]) {
      const t = last([text]);
      assert.ok(t.decision.actions.some((a) => a.type === "SHOW_COLOUR_CHOICES"), text);
      assert.ok(!tags(t).includes("STOCK"), text);
    }
  });

  test("an Arabic answer carries no English field label or English sentence — only names, units and figures", () => {
    const LATIN_ALLOWED = /VOYAH|MHERO|Courage|Taishan|Dream|Passion|Free|Monza|S\.A\.L\.|WLTP|CLTC|EV|PHEV|EREV|BEV|kWh|km|hp|HP|mm|L\b|AC|DC|kW|Pearl|Black|White|Grey|Crayon|Obsidian|Sapphire|Blue|Storm|Midnight|British|Racing|Green|Sage|Titanium|Piano|Olive|Clouds|Trade-in|https?:\/\/\S+/g;
    for (const text of ["ضمان الكوراج", "كم مقعد التايشان", "مدى الكوراج", "قوة الكوراج", "كم سعر التايشان", "بدي تجربة قيادة للكوراج", "وين موقعكم", "تقسيط", "شو يعني هيدا"]) {
      const t = last([text]);
      const left = words(t).replace(LATIN_ALLOWED, "");
      const english = left.match(/[A-Za-z]{3,}/g) ?? [];
      assert.deepEqual(english, [], `${text} → ${words(t)}`);
    }
    assert.match(words(last(["ضمان الكوراج"])), /6 سنوات على السيارة و10 سنوات على البطارية/);
  });

  test("French: where are you, a test drive", () => {
    assert.match(words(last(["où êtes-vous situés ?"])), /Horch Tabet/);
    assert.deepEqual(tags(last(["je voudrais un essai de la courage"])), ["TEST_DRIVE"]);
  });
});

/* ═════════════════════════ PHASE 19 · media safety ═════════════════════════ */

describe("Phase 19 — media", () => {
  test("no file ever leaves from a weak or rejected model word", () => {
    for (const text of ["It's my dream car", "dream is nice", "free delivery?", "passion looks good honestly", "I need a person"]) {
      assert.equal(files(last([text])).length, 0, text);
    }
  });

  test("the default video is the workbook's first colour WITH a video that fits the channel — never the oversized one", () => {
    for (const msgs of [["courage", "any"], ["courage price"], ["I want to buy the courage"]]) {
      const v = last(msgs).decision.actions.find((a) => a.type === "SEND_COLOUR_VIDEO");
      assert.ok(v && v.type === "SEND_COLOUR_VIDEO", msgs.join());
      if (v && v.type === "SEND_COLOUR_VIDEO") {
        assert.notEqual(v.colour, "pearl-white", "40.6 MB, over WhatsApp's 16 MB");
        assert.ok((v.asset.bytes ?? 0) <= 16_000_000, msgs.join());
      }
    }
    // Asked for by name, the oversized video still reaches the customer — as a link, never a failed upload.
    const white = last(["courage", "pearl white"]);
    assert.equal(files(white).length, 0);
    assert.match(words(white), /Pearl White: https:\/\//);
  });

  test("orphan small copies of colours that no longer exist are never sent or offered", () => {
    const mhero2 = last(["mhero 2"]);
    assert.match(words(mhero2), /Piano Black/);
    assert.doesNotMatch(words(mhero2), /\b(Black|Green|White)\b(?<!Piano Black|Olive Green|Clouds White)/);
    const dream = last(["dream"]).decision.actions.find((a) => a.type === "SEND_COLOUR_VIDEO");
    assert.ok(dream && dream.type === "SEND_COLOUR_VIDEO" && dream.colour === "midnight-black");
  });

  test("colours with no video are not offered: no Recon Green, no Polar Silver", () => {
    assert.doesNotMatch(words(last(["mhero 1"])), /Recon Green|Polar Silver/);
    assert.match(words(last(["mhero 1", "green"])), /don't have a video of the MHERO 1 in green/i);
  });

  test("a brochure sent with 'which one first?' is not sent again when the customer picks that car", () => {
    const turns = converse(["courage and dream", "black", "VOYAH Courage"]);
    assert.equal(files(turns[0]).filter((p) => p.kind === "file" && p.fileKind === "document").length, 2);
    assert.ok(!turns[2].decision.actions.some((a) => a.type === "SEND_BROCHURE"), "the Courage brochure went out two messages ago");
    assert.ok(turns[2].decision.actions.some((a) => a.type === "SEND_COLOUR_VIDEO"));
    // Asked for, it is sent again.
    assert.ok(last(["courage and dream", "courage brochure"]).decision.actions.some((a) => a.type === "SEND_BROCHURE"));
  });

  test("'all brochures' is a menu, not eight files; a two-car account still just sends them", () => {
    const all = last(["send me all the brochures"]);
    assert.equal(files(all).length, 0);
    assert.match(words(all), /which model or models/);
    assert.equal(files(last(["all brochures"], { brand: "mhero" })).length, 2);
    assert.equal(files(last(["all brochures", "VOYAH Taishan"])).length, 1);
  });
});

/* ═════════════════════════ what must never change ═════════════════════════ */

describe("the rules that stay", () => {
  test("no reply in this whole file's language ever states money, stock, or 'booked'", () => {
    const probes = [
      "courage price", "how much is the taishan in dollars", "best price for the dream?", "any discount on the free", "is the courage in stock",
      "I want to buy the courage", "reserve one for me", "my budget is 40k", "test drive courage tomorrow at 11", "how much is my car worth?",
    ];
    for (const text of probes) {
      const w = words(last([text]));
      for (const re of [...NO_MONEY, /\bin stock\b/i, /\bavailable now\b/i, /\bis booked\b|\bconfirmed for\b/i]) assert.doesNotMatch(w, re, text);
    }
  });

  test("the same message in the same state always decides the same thing", () => {
    const a = last(["courage", "price", "and the taishan?"]);
    const b = last(["courage", "price", "and the taishan?"]);
    assert.deepEqual(a.decision.actions, b.decision.actions);
    assert.deepEqual(a.decision.nextState, b.decision.nextState);
  });
});
