/**
 * SILENT HAND-OFF (Samer, 2026-10-06): he highlighted 66 of the bot's 101 sentences in the workbook
 * export and said "everything highlighted in yellow should be removed", then chose: the bot stays
 * silent on those and Sales is alerted. What stays is information: the welcome and menus, car facts,
 * type menus, brochures, colours and videos, installments and trade-in information, address and hours.
 *
 * These tests run the PRODUCTION knowledge (MONZA_KNOWLEDGE). The older suites run the talkative
 * decisions (tests/_talkative.ts) so the engine's rules stay proven.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runConversation } from "@/lib/wasales/flow";
import { MONZA_KNOWLEDGE, decisionsOf } from "@/lib/wasales/knowledge";
import { loadCatalog } from "@/lib/wasales/catalog";
import { liveMedia } from "@/tests/_live-library";
import { SILENCED_TEXT, SPOKEN_TEXT, applySilence, isSilenced } from "@/lib/wasales/silence";
import type { EngineAction, TextKey } from "@/lib/wasales/actions";
import type { EngineInput } from "@/lib/wasales/engine";
import type { OutboundPart } from "@/lib/wasales/templates";

const DEPS = { knowledge: MONZA_KNOWLEDGE, catalog: loadCatalog(), media: liveMedia, ttlHours: 72 };
const T0 = Date.parse("2026-10-06T09:00:00.000Z"); // a Tuesday, within hours
const SEND = { channel: "whatsapp" as const, autoSendEnabled: true, replyWindowOpen: true, humanLock: false, liveSending: true, attachmentsSupported: true, linkOversize: true };

function talk(messages: string[], opts: { hasMedia?: boolean[] } = {}) {
  const inputs: EngineInput[] = messages.map((text, i) => ({
    text,
    hasMedia: opts.hasMedia?.[i] ?? false,
    brand: "monza",
    channel: "whatsapp",
    conversationIsNew: i === 0,
    now: new Date(T0 + i * 60_000).toISOString(),
  }));
  return runConversation(inputs, DEPS, SEND).turns;
}
const last = (messages: string[], opts?: { hasMedia?: boolean[] }) => talk(messages, opts).at(-1)!;
const texts = (parts: readonly OutboundPart[]) => parts.filter((p): p is Extract<OutboundPart, { kind: "text" }> => p.kind === "text").map((p) => p.text);
const alerts = (actions: readonly EngineAction[]) => actions.filter((a): a is Extract<EngineAction, { type: "ALERT_SALES" }> => a.type === "ALERT_SALES");

describe("the decision that ships", () => {
  test("production is silent; the talkative decisions exist only for the older tests", () => {
    assert.equal(decisionsOf(MONZA_KNOWLEDGE).silentHandoff, true);
  });

  test("every fixed sentence is either silenced or deliberately spoken — none forgotten", () => {
    const src = readFileSync(join(process.cwd(), "lib/wasales/actions.ts"), "utf8");
    const block = src.slice(src.indexOf("export type TextKey ="), src.indexOf(";", src.indexOf("export type TextKey =")));
    const keys = [...block.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1] as TextKey);
    assert.ok(keys.length > 60);
    for (const k of keys) assert.ok(SILENCED_TEXT.has(k) || SPOKEN_TEXT.has(k), `${k} is neither silenced nor spoken`);
    for (const k of SPOKEN_TEXT) assert.ok(!SILENCED_TEXT.has(k), k);
    assert.equal(SILENCED_TEXT.size, 59);
  });
});

describe("what the bot still says", () => {
  test("a greeting gets the welcome and the departments", () => {
    const t = texts(last(["hi"]).plan);
    assert.equal(t.length, 1);
    assert.match(t[0], /^Hello and welcome to Monza S\.A\.L\./);
  });

  test("a car gets its brochure and the colour question", () => {
    const t = texts(last(["courage"]).plan);
    assert.ok(t.some((x) => x.includes("Here is the VOYAH Courage brochure")));
    assert.ok(t.some((x) => x.startsWith("Which exterior colour")));
  });

  test("a fact is answered from the workbook", () => {
    const t = texts(last(["courage", "how much hp?"]).plan);
    assert.deepEqual(t, ["The VOYAH Courage produces 430 HP."]);
  });

  test("the address and the hours are given; the phone number is not", () => {
    assert.match(texts(last(["where are you located?"]).plan).join(" "), /Horch Tabet/);
    assert.match(texts(last(["what are your opening hours?"]).plan).join(" "), /Monday to Friday/);
    const n = last(["what's your phone number?"]);
    assert.deepEqual(texts(n.plan), []);
    assert.ok(alerts(n.decision.actions).length >= 1);
  });

  test("installments: the facilities are confirmed, and the same-chat sentence stays (row 52 kept)", () => {
    const t = texts(last(["courage", "do you have installments?"]).plan);
    assert.ok(t.some((x) => x.startsWith("Yes, we offer installment and payment facilities")));
  });

  test("trade-in: the information is given (row 58 kept)", () => {
    assert.ok(texts(last(["do you take trade ins?"]).plan).some((x) => x.startsWith("Yes, we do accept trade-ins.")));
  });

  test("the type menus and the 7-seater answer stay", () => {
    assert.match(texts(last(["what electric cars do you have?"]).plan).join(" "), /fully electric driving/);
    assert.match(texts(last(["7 seater?"]).plan).join(" "), /For 7 seats/);
  });
});

describe("what the bot no longer says — silent, and a person is told", () => {
  /** Words that only the silenced sentences carry: none may reach the customer. A brochure, a video or a colour question may. */
  const FORBIDDEN = /Sales Team|team member|sales team|please call|contact us|WhatsApp at|^Sorry|^No problem|^Understood|^Noted|^Thank you|^Certainly|^Of course|^Wonderful|^We're |^You're |^Happy to|^Yes, we|test drive|not confirmed yet\. Our|not in our approved|I don't have|We currently specialize|We don't currently offer|Did you mean|Which car would you like to see in/m;
  const silent = (messages: string[], why: RegExp, opts?: { hasMedia?: boolean[] }) => {
    const d = last(messages, opts);
    for (const t of texts(d.plan)) assert.doesNotMatch(t, FORBIDDEN, `${messages.at(-1)} → ${t}`);
    const a = alerts(d.decision.actions);
    assert.equal(a.length, 1, `${messages.at(-1)}: one alert, got ${a.length}`);
    assert.match(`${a[0].kind} ${a[0].tags?.join(" ") ?? ""} ${a[0].reason ?? ""}`, why, messages.at(-1));
    assert.ok(d.decision.reasons.some((r) => r.startsWith("Not said (silent hand-off)")), d.decision.reasons.join(" | "));
    return d;
  };

  test("the price, after the brochure and video were already sent", () => {
    const d = silent(["courage", "pearl black", "how much is it?"], /PRICE/);
    assert.deepEqual(texts(d.plan), []);
    assert.equal(d.decision.outcome, "NO_AUTOMATIC_ACTION");
  });
  test("offers and discount", () => {
    silent(["courage", "any discount?"], /DISCOUNT/);
  });
  test("stock", () => {
    silent(["courage", "is it available?"], /STOCK/);
  });
  test("a test drive, with or without a time", () => {
    silent(["courage", "can i test drive it?"], /TEST_DRIVE/);
    silent(["courage", "test drive tomorrow at 4"], /TEST_DRIVE/);
  });
  test("a Sunday visit", () => {
    silent(["can i pass by on sunday?"], /VISIT|TEST_DRIVE|NEEDS_PERSON/);
  });
  test("a person, a call-back", () => {
    silent(["i want to talk to someone"], /HUMAN/);
    silent(["call me please"], /CALLBACK/);
  });
  test("the service number and administration", () => {
    silent(["my car needs service"], /NEEDS_PERSON|QUESTION/);
    silent(["administration"], /NEEDS_PERSON|QUESTION/);
  });
  test("I'll take it", () => {
    silent(["courage", "i'll take it"], /BUYING/);
  });
  test("a question the workbook cannot answer", () => {
    silent(["courage", "what is the wheel size?"], /QUESTION|NEEDS_PERSON/);
    silent(["do you sell tesla?"], /NEEDS_PERSON|QUESTION/);
  });
  test("a photo with no words", () => {
    silent(["courage", ""], /photo|NEEDS_PERSON/i, { hasMedia: [false, true] });
  });
  test("stop, not interested, wrong number: nothing sent, a person sees it", () => {
    silent(["stop messaging me"], /stop/i);
    silent(["not interested"], /not interested/i);
    silent(["wrong number"], /wrong number/i);
  });
  test("kept waiting", () => {
    silent(["i've been waiting since yesterday"], /OVERDUE|waiting/i);
  });

  test("thank you and no thanks: nothing sent, and nobody alerted", () => {
    for (const d of [last(["courage", "thanks"]), last(["courage", "no thanks"])]) {
      assert.deepEqual(texts(d.plan), []);
      assert.equal(alerts(d.decision.actions).length, 0);
    }
  });

  test("an ordinary word that might be a car is not asked about, and nothing follows a later 'yes'", () => {
    const [first, second] = talk(["is it free?", "yes"]);
    assert.deepEqual(texts(first.plan), []);
    assert.equal(first.decision.nextState.awaiting, "NONE");
    assert.equal(second.plan.filter((p) => p.kind === "file").length, 0);
  });

  test("a comparison is not made — Sales compares (row 20)", () => {
    silent(["compare the courage and the free 318"], /QUESTION|NEEDS_PERSON/);
  });

  test("a colour with no video", () => {
    const d = last(["courage", "do you have it in green?"]);
    assert.ok(!texts(d.plan).some((x) => x.startsWith("Sorry")));
  });

  test("a fact the workbook does not state is left out, the confirmed ones still answered", () => {
    const d = last(["passion l", "trunk size and warranty?"]);
    const t = texts(d.plan).join(" ");
    assert.doesNotMatch(t, /is not confirmed yet\. Our Sales Team/);
    assert.match(t, /Warranty: 6 years/);
  });
});

describe("the rule itself", () => {
  test("the hand-off sentence, the phone number, the confirm question and an empty category are silenced", () => {
    assert.equal(isSilenced({ type: "SEND_CONTACT_FALLBACK", reasons: [] }), true);
    assert.equal(isSilenced({ type: "SEND_COMPARISON", models: ["COURAGE", "FREE_318"], rows: [] }), true);
    assert.equal(isSilenced({ type: "SEND_GLOBAL_INFO", key: "CONTACT_NUMBER", value: "x", source: "" }), true);
    assert.equal(isSilenced({ type: "SEND_GLOBAL_INFO", key: "LOCATION", value: "x", source: "" }), false);
    assert.equal(isSilenced({ type: "SHOW_MODEL_CHOICES", models: ["DREAM"], greet: false, narrowed: false, prompt: "confirm" }), true);
    assert.equal(isSilenced({ type: "SHOW_MODEL_CHOICES", models: ["DREAM"], greet: false, narrowed: false }), false);
    assert.equal(isSilenced({ type: "SHOW_CATEGORY", filter: "SEATS", seats: 9, groups: [] }), true);
    assert.equal(isSilenced({ type: "SHOW_CATEGORY", filter: "SEATS", seats: 7, groups: [{ bucket: null, models: ["DREAM"] }] }), false);
  });

  test("alerts, flags and gaps are never dropped; a dropped request adds one alert when none existed", () => {
    const alert: EngineAction = { type: "ALERT_SALES", kind: "PRICE", models: ["COURAGE"], name: null, phone: null, slot: null };
    const withAlert = applySilence([{ type: "SEND_TEXT", key: "PRICE_HANDOFF", models: ["COURAGE"] }, alert], "NONE");
    assert.deepEqual(withAlert.actions, [alert]);
    assert.equal(withAlert.alertReason, null);
    const without = applySilence([{ type: "SEND_TEXT", key: "HUMAN_HANDOFF", models: [] }, { type: "FLAG_FOR_STAFF", reason: "x" }], "NONE");
    assert.deepEqual(without.actions, [{ type: "FLAG_FOR_STAFF", reason: "x" }]);
    assert.ok(without.alertReason);
    const polite = applySilence([{ type: "SEND_TEXT", key: "YOU_ARE_WELCOME", models: [] }], "NONE");
    assert.equal(polite.alertReason, null);
  });

  test("a dropped question resets what the state waits for", () => {
    const s = applySilence([{ type: "SEND_TEXT", key: "CALLBACK_ASK_NUMBER", models: [] }], "LEAD_NAME");
    assert.equal(s.resetAwaiting, true);
    const kept = applySilence([{ type: "SHOW_COLOUR_CHOICES", model: "COURAGE", colours: [{ id: "black", name: "Pearl Black" }] }], "COLOUR");
    assert.equal(kept.resetAwaiting, false);
  });
});
