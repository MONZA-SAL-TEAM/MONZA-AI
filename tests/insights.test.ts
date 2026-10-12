/**
 * INSIGHTS (Samer, 2026-10-12): the signals the bot records per message, and the picture built from
 * them. What must hold: a signal carries labels only (never a customer's words); the picture counts
 * people, not messages, where it says people; the stage is the furthest a person got; the CSV is
 * defused; and a message the engine excludes leaves no row.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decide } from "@/lib/wasales/engine";
import { freshState } from "@/lib/wasales/context";
import { MONZA_KNOWLEDGE } from "@/lib/wasales/knowledge";
import { loadCatalog } from "@/lib/wasales/catalog";
import { liveMedia } from "@/tests/_live-library";
import { signalFromDecision, stageOf, furthestStage, topicLabel, TOPIC_LABEL, type SignalMeta } from "@/lib/wasales/signal";
import { buildInsights, clientsCsv, WEEKS, type InsightRows, type SignalRow } from "@/lib/insights/insights";
import { INTENTS } from "@/lib/wasales/intent";

const DEPS = { knowledge: MONZA_KNOWLEDGE, catalog: loadCatalog(), media: liveMedia, ttlHours: 72 };
const NOW = "2026-10-12T09:00:00.000Z";
const META: SignalMeta = { accountId: "wa-monza", brand: "monza", channel: "whatsapp", conversationId: "c1", externalMessageId: "m1", at: NOW, hasMedia: false };

function signal(text: string, meta: Partial<SignalMeta> = {}) {
  const m = { ...META, ...meta };
  const d = decide({ text, hasMedia: m.hasMedia, brand: "monza", channel: "whatsapp", conversationIsNew: true, now: m.at }, freshState(), DEPS);
  return signalFromDecision(d, m);
}

describe("a signal is labels, never words", () => {
  test("the car, the question, the colour and the language are read; the words are not kept", () => {
    const s = signal("how much is the courage in pearl black?");
    assert.ok(s);
    assert.deepEqual(s.models, ["COURAGE"]);
    assert.ok(s.intents.includes("PRICE"));
    assert.equal(s.colour, "Pearl Black");
    assert.equal(s.language, "en");
    assert.ok(!JSON.stringify(s).toLowerCase().includes("how much"), "the customer's words must not be in the signal");
    const ar = signal("قديش سعر الكوراج");
    assert.ok(ar);
    assert.equal(ar.language, "ar");
    assert.ok(!JSON.stringify(ar).includes("قديش"));
  });

  test("the alert Sales got, and what the bot held back, are recorded", () => {
    const s = signal("courage price?");
    assert.ok(s);
    assert.equal(s.alertKind, "PRICE");
    assert.ok(s.silenced.includes("PRICE_HANDOFF"), s.silenced.join());
    assert.ok(s.offered.includes("SEND_BROCHURE"));
  });

  test("hello and thanks are not topics; a scam leaves no row", () => {
    const s = signal("hi");
    assert.ok(s);
    assert.deepEqual(s.intents, []);
    assert.equal(signal("Your page will be disabled. Verify your account now at meta-support-verify.com"), null);
  });

  test("every intent has a label a person can read", () => {
    for (const i of INTENTS) {
      if (["UNKNOWN", "GREETING", "ACKNOWLEDGEMENT", "YES", "NO"].includes(i)) continue;
      assert.ok(TOPIC_LABEL[i], `${i} has no label`);
      assert.doesNotMatch(topicLabel(i), /_/);
    }
  });

  test("the stage is the furthest a person got, and never goes backwards", () => {
    assert.equal(stageOf(["PRICE"], ["COURAGE"]), "pricing");
    assert.equal(stageOf([], ["COURAGE"]), "interested");
    assert.equal(stageOf(["RANGE"], []), "asking");
    assert.equal(stageOf(["BUYING_INTENT"], []), "buying");
    assert.equal(furthestStage(["asking", "buying", "pricing"]), "buying");
    assert.equal(furthestStage([]), "wrote");
  });

  test("the webhook records the signal where it reads the words, and the migration locks the table", () => {
    const store = readFileSync(join(process.cwd(), "lib/channels/store.ts"), "utf8");
    assert.ok(store.indexOf("await recordSignal(sb, event.text") > store.indexOf("await noteInboundLead(sb, {"));
    const sql = readFileSync(join(process.cwd(), "database/migrations/020_sales_signals.sql"), "utf8");
    assert.match(sql, /enable row level security/);
    assert.doesNotMatch(sql, /create policy/i);
    assert.doesNotMatch(sql, /\bbody\b|\btext\s+not null\b.*words/i);
    assert.match(sql, /unique \(account_id, external_message_id\)/);
  });
});

describe("the picture", () => {
  const row = (o: Partial<SignalRow> & { conversation_id: string; at: string }): SignalRow => ({
    account_id: "wa-monza",
    brand: "monza",
    channel: "whatsapp",
    language: "en",
    intents: [],
    models: [],
    weak_models: [],
    colour: null,
    has_media: false,
    alert_kind: null,
    alert_tags: [],
    offered: [],
    silenced: [],
    ...o,
  });
  const daysAgo = (d: number) => new Date(Date.parse(NOW) - d * 86_400_000).toISOString();
  const rows: InsightRows = {
    signals: [
      row({ conversation_id: "c1", at: daysAgo(1), intents: ["PRICE"], models: ["COURAGE"], colour: "Pearl Black", alert_kind: "PRICE" }),
      row({ conversation_id: "c1", at: daysAgo(2), intents: ["BUYING_INTENT"], models: ["COURAGE"] }),
      row({ conversation_id: "c1", at: daysAgo(3), intents: ["RANGE"], models: ["COURAGE"] }),
      row({ conversation_id: "c2", at: daysAgo(5), intents: ["TEST_DRIVE"], models: ["COURAGE", "FREE_318"], language: "ar" }),
      row({ conversation_id: "c3", at: daysAgo(10), intents: [], models: [], channel: "instagram", account_id: "ig-voyah", brand: "voyah" }),
      row({ conversation_id: "c4", at: daysAgo(200), intents: ["PRICE"], models: ["TAISHAN"] }),
    ],
    conversations: [
      { id: "c1", account_id: "wa-monza", brand: "monza", peer_external_id: "96170000001", peer_display: "Rami", created_at: daysAgo(3) },
      { id: "c2", account_id: "wa-monza", brand: "monza", peer_external_id: "96170000002", peer_display: null, created_at: daysAgo(5) },
      { id: "c3", account_id: "ig-voyah", brand: "voyah", peer_external_id: "1784100000", peer_display: "=cmd", created_at: daysAgo(10) },
      { id: "c4", account_id: "wa-monza", brand: "monza", peer_external_id: "96170000004", peer_display: "Old", created_at: daysAgo(200) },
    ],
    leads: [{ id: "L1", display_name: "Rami K.", phone: "96170000001" }],
    leadConversations: [{ lead_id: "L1", conversation_id: "c1" }],
    alerts: [
      { conversation_ref: "c1", kind: "PRICE", status: "open", created_at: daysAgo(1) },
      { conversation_ref: "c2", kind: "TEST_DRIVE", status: "done", created_at: daysAgo(5) },
    ],
  };

  test("people are counted once however many messages they wrote; the period applies", () => {
    const ins = buildInsights(rows, { days: 90, now: NOW });
    assert.equal(ins.totals.people, 3);
    assert.equal(ins.totals.messages, 5);
    assert.equal(ins.totals.interested, 2);
    assert.equal(ins.totals.hot, 1);
    assert.equal(ins.totals.waiting, 1);
    assert.equal(buildInsights(rows, { days: 0, now: NOW }).totals.people, 4);
  });

  test("a car counts its people and its questions, and the colours asked for", () => {
    const ins = buildInsights(rows, { days: 90, now: NOW });
    const courage = ins.cars.find((c) => c.code === "COURAGE")!;
    assert.equal(courage.people, 2);
    assert.equal(courage.messages, 4);
    assert.equal(courage.price, 1);
    assert.equal(courage.testDrive, 1);
    assert.equal(courage.buying, 1);
    assert.deepEqual(courage.colours, [{ key: "Pearl Black", label: "Pearl Black", n: 1 }]);
    assert.equal(courage.weekly.length, WEEKS);
    assert.equal(courage.weekly[WEEKS - 1], 2);
    assert.equal(ins.cars[0].code, "COURAGE");
    const free = ins.cars.find((c) => c.code === "FREE_318")!;
    assert.equal(free.people, 1);
  });

  test("a client: the lead's name and number, the furthest stage, the open alert, the chat link", () => {
    const ins = buildInsights(rows, { days: 90, now: NOW });
    const rami = ins.clients.find((c) => c.id === "lead:L1")!;
    assert.equal(rami.name, "Rami K.");
    assert.equal(rami.phone, "96170000001");
    assert.equal(rami.stage, "buying");
    assert.deepEqual(rami.cars, ["VOYAH Courage"]);
    assert.deepEqual(rami.topics.sort(), ["Price", "Range", "Wants to buy"].sort());
    assert.equal(rami.waiting, "PRICE");
    assert.ok(rami.threadId);
    assert.equal(ins.clients[0].id, "lead:L1");
    const ig = ins.clients.find((c) => c.id === "chat:c3")!;
    assert.equal(ig.phone, null, "an Instagram id is never a phone");
    assert.equal(ig.threadId, null);
    assert.equal(ig.stage, "wrote");
  });

  test("filters by brand, channel and car", () => {
    assert.equal(buildInsights(rows, { days: 90, now: NOW, channel: "instagram" }).totals.people, 1);
    assert.equal(buildInsights(rows, { days: 90, now: NOW, brand: "monza" }).totals.people, 2);
    assert.equal(buildInsights(rows, { days: 90, now: NOW, model: "FREE_318" }).clients.length, 1);
  });

  test("the CSV is defused and carries no message text", () => {
    const ins = buildInsights(rows, { days: 90, now: NOW });
    const csv = clientsCsv(ins.clients);
    assert.match(csv, /^Name,Phone,Channel/);
    assert.match(csv, /'=cmd/);
    assert.match(csv, /Wants to buy/);
  });
});
