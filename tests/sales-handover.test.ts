/**
 * Human takeover pauses the bot, it does not kill it (Samer, 2026-09-17):
 *
 *   1. the bot talks to a customer
 *   2. a salesperson replies
 *   3. the bot stays quiet while that conversation is live
 *   4. the customer returns later with a new question
 *   5. the bot reads it again, and answers only what came after the person
 *
 * Plus the explicit "Hand to a person", which holds the bot out until "Suggest again".
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { freshSaved, handoverResumeHours, suggestForThread, SUGGESTION_AUTOMATION_PREFIX, type SavedSuggestion } from "@/lib/wasales/suggest";
import { folderMedia, loadCatalog } from "@/lib/wasales/catalog";
import { MONZA_KNOWLEDGE } from "@/lib/wasales/knowledge";
import { actionLabel } from "@/lib/wasales/templates";
import { freshState } from "@/lib/wasales/context";
import type { InboxMessage } from "@/lib/inbox/types";

const DEPS = { knowledge: MONZA_KNOWLEDGE, catalog: loadCatalog(), media: folderMedia, ttlHours: 72 };
const T0 = Date.parse("2026-09-17T07:00:00.000Z");
const HOUR = 3_600_000;

function m(id: string, direction: "in" | "out", text: string, hours: number, extra: Partial<InboxMessage> = {}): InboxMessage {
  return {
    id,
    conversationId: "wa-monza~c1",
    direction,
    author: direction === "in" ? "customer" : "staff",
    text,
    at: new Date(T0 + hours * HOUR).toISOString(),
    status: direction === "in" ? "received" : "sent",
    ...extra,
  };
}

const bot = (id: string, text: string, hours: number) =>
  m(id, "out", text, hours, { author: "automation", automationId: `${SUGGESTION_AUTOMATION_PREFIX}:v:0` });

const facts = (messages: InboxMessage[]) => ({ brand: "monza", channel: "whatsapp" as const, messages, windowOpen: true });
const opts = { liveSending: true, resumeHours: 12 };

describe("a person's reply pauses the bot", () => {
  // 1. The bot answered "hi" with the welcome, and a horsepower question.
  const conversation = [
    m("c1", "in", "hi", 0),
    bot("b1", "Hello and welcome…", 0.01),
    m("c2", "in", "courage hp?", 0.1),
    bot("b2", "The VOYAH Courage produces 320 kW / 435 PS.", 0.11),
    // 2. A salesperson replies from the business phone.
    m("p1", "out", "Hi! Karim here, when would you like to pass by?", 0.5),
  ];

  test("3. while the person is in the conversation, the bot stays out — even for a spec question", () => {
    const messages = [...conversation, m("c3", "in", "what's the range?", 1)];
    const s = suggestForThread(facts(messages), freshSaved(), DEPS, opts);
    assert.equal(s.kind, "handed_over");
    if (s.kind === "handed_over") {
      assert.equal(s.manual, false);
      assert.equal(s.since, conversation[4].at);
    }
  });

  test("3b. eleven hours later is still the person's conversation", () => {
    const messages = [...conversation, m("c3", "in", "range?", 0.5 + 11)];
    assert.equal(suggestForThread(facts(messages), freshSaved(), DEPS, opts).kind, "handed_over");
  });

  test("4 + 5. the customer returns after 12 quiet hours with a new question: answered, and only that", () => {
    const messages = [...conversation, m("c3", "in", "what's the range of the courage?", 0.5 + 12.5)];
    const s = suggestForThread(facts(messages), freshSaved(), DEPS, opts);
    assert.equal(s.kind, "suggestion");
    if (s.kind === "suggestion") {
      assert.deepEqual(s.answered, ["c3"], "only the message after the person's reply");
      const labels = s.turn.decision.actions.map(actionLabel);
      assert.ok(labels.some((l) => l.startsWith("SEND COURAGE RANGE")), labels.join(" | "));
      assert.ok(!labels.some((l) => l.includes("WELCOME") || l.startsWith("SHOW DEPARTMENTS")), "no welcome: this is not a new conversation");
    }
  });

  test("the resume gap is configurable and safe", () => {
    assert.equal(handoverResumeHours(undefined), 12);
    assert.equal(handoverResumeHours("6"), 6);
    assert.equal(handoverResumeHours("0"), 12);
    assert.equal(handoverResumeHours("three"), 12);
    const messages = [...conversation, m("c3", "in", "range?", 0.5 + 7)];
    assert.equal(suggestForThread(facts(messages), freshSaved(), DEPS, { liveSending: true, resumeHours: 6 }).kind, "suggestion");
    assert.equal(suggestForThread(facts(messages), freshSaved(), DEPS, { liveSending: true, resumeHours: 8 }).kind, "handed_over");
  });

  test("a person who replied just now with nothing from the customer since: theirs", () => {
    assert.equal(suggestForThread(facts(conversation), freshSaved(), DEPS, opts).kind, "handed_over");
  });
});

describe("hand to a person", () => {
  test("manual takeover holds the bot out however quiet the chat gets", () => {
    const saved: SavedSuggestion = { ...freshSaved(), state: { ...freshState(), manualTakeover: true } };
    const messages = [m("c1", "in", "courage hp?", 0), m("c2", "in", "range?", 200)];
    const s = suggestForThread(facts(messages), saved, DEPS, opts);
    assert.equal(s.kind, "handed_over");
    if (s.kind === "handed_over") assert.equal(s.manual, true);
  });

  test("Suggest again clears it: the same chat is answered", () => {
    const saved: SavedSuggestion = { ...freshSaved(), state: { ...freshState(), manualTakeover: false }, resumedAt: new Date(T0 + 199 * HOUR).toISOString() };
    const messages = [m("c1", "in", "courage hp?", 0), m("p1", "out", "Karim here", 1), m("c2", "in", "range?", 200)];
    assert.equal(suggestForThread(facts(messages), saved, DEPS, opts).kind, "suggestion");
  });
});
