/**
 * Phase 5: one summary per person (lib/insights/people.ts), the Research Lab's question (query.ts), the
 * analysis pages (analysis.ts) and the Lab's CSV (lab.ts). Each person counted once; shares only over
 * people who said it; every count opens exactly the people it counted.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { InsightRows, ObservationRow, SignalRow } from "@/lib/insights/insights";
import { buildPersonFacts } from "@/lib/insights/people";
import { matchesQuery, parseInsightQuery, toSearch, labHref } from "@/lib/insights/query";
import { channelsView, colourMatrix, conversationsView, modelDetail, modelsTable, qualityView } from "@/lib/insights/analysis";
import { labCsv } from "@/lib/insights/lab";

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const C3 = "33333333-3333-4333-8333-333333333333";
const L1 = "44444444-4444-4444-8444-444444444444";
const NOW = Date.parse("2026-10-12T12:00:00Z");

const sig = (conv: string, at: string, intents: string[], models: string[] = [], channel = "whatsapp"): SignalRow => ({
  account_id: channel === "whatsapp" ? "wa-monza" : "ig-voyah", brand: "monza", channel, conversation_id: conv, at, language: "en", intents, models, weak_models: [], colour: null, has_media: false, alert_kind: null, alert_tags: [], offered: [], silenced: [],
});
const ob = (conv: string, at: string, kind: string, value: string, extra: Partial<ObservationRow> = {}): ObservationRow => ({ conversation_id: conv, at, kind, stance: "mentioned", model: null, binding: null, part: null, value, detail: null, ...extra });

const ROWS: InsightRows = {
  signals: [
    // One person (a lead) on two chats, five messages.
    sig(C1, "2026-10-01T09:00:00Z", ["PRICE"], ["COURAGE"]),
    sig(C1, "2026-10-01T09:01:00Z", ["COLOUR"], ["COURAGE"]),
    sig(C1, "2026-10-02T09:00:00Z", ["FINANCING"]),
    sig(C2, "2026-10-05T09:00:00Z", ["PRICE"], ["FREE_318"], "instagram"),
    sig(C2, "2026-10-06T09:00:00Z", ["BUYING_INTENT"], ["COURAGE"], "instagram"),
    // Another person, one chat.
    sig(C3, "2026-10-10T09:00:00Z", ["PRICE"], ["COURAGE"]),
  ],
  observations: [
    ob(C1, "2026-10-01T09:01:00Z", "colour", "black", { stance: "wants", model: "COURAGE", part: "exterior", binding: "conversation" }),
    ob(C1, "2026-10-02T09:00:00Z", "budget", "total_40k_50k", { amount_min: 45000, amount_max: 45000, currency: "USD", amount_kind: "total" }),
    ob(C1, "2026-10-02T09:00:00Z", "city", "metn"),
    ob(C3, "2026-10-10T09:00:00Z", "colour", "white", { stance: "asked", model: "COURAGE", part: "exterior", binding: "same_clause" }),
    ob(C3, "2026-10-10T09:00:00Z", "colour", "black", { stance: "rejects", model: "COURAGE", part: "exterior", binding: "same_clause" }),
    ob(C3, "2026-10-10T09:00:00Z", "competitor", "byd", { stance: "compared" }),
  ],
  conversations: [
    { id: C1, account_id: "wa-monza", brand: "monza", peer_external_id: "96171222333", peer_display: "Rami", created_at: null },
    { id: C2, account_id: "ig-voyah", brand: "voyah", peer_external_id: "178414", peer_display: "@rami", created_at: null },
    { id: C3, account_id: "wa-monza", brand: "monza", peer_external_id: "96171999888", peer_display: "Lina", created_at: null },
  ],
  leads: [{ id: L1, display_name: "Rami K", phone: "+96171222333" }],
  leadConversations: [
    { lead_id: L1, conversation_id: C1 },
    { lead_id: L1, conversation_id: C2 },
  ],
  alerts: [{ conversation_ref: C3, kind: "PRICE", status: "open", created_at: "2026-10-10T09:00:00Z" }],
};
const people = buildPersonFacts(ROWS, { ownerByConv: { [C3]: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, firstTouchByLead: { [L1]: "ad" } });
const rami = people.find((p) => p.key === `lead:${L1}`)!;
const lina = people.find((p) => p.key === `chat:${C3}`)!;
const personOf = (conv: string) => (conv === C1 || conv === C2 ? `lead:${L1}` : `chat:${conv}`);

describe("one summary per person", () => {
  test("a lead on two chats with five messages is ONE person", () => {
    assert.equal(people.length, 2);
    assert.equal(rami.messages, 5);
    assert.deepEqual(rami.channels.sort(), ["instagram", "whatsapp"]);
    assert.equal(rami.primaryModel, "COURAGE");
    assert.equal(rami.stage, "buying");
    assert.deepEqual(rami.coloursWanted, ["COURAGE:black"]);
    assert.equal(rami.budgetBand, "total_40k_50k");
    assert.equal(rami.firstTouch, "ad");
  });
  test("refusals stay refusals; owner and waiting are carried", () => {
    assert.deepEqual(lina.coloursRejected, ["COURAGE:black"]);
    assert.deepEqual(lina.coloursWanted, ["COURAGE:white"]);
    assert.equal(lina.waiting, true);
    assert.ok(lina.ownerId);
  });
  test("never a name or a phone in the summary", () => {
    const json = JSON.stringify(people);
    assert.ok(!json.includes("Rami"));
    assert.ok(!json.includes("96171222333"));
  });
});

describe("the Lab's question", () => {
  test("round trip, and anything unknown is dropped", () => {
    const q = parseInsightQuery(new URLSearchParams("model=COURAGE&colour=black&budget=total_40k_50k&city=metn&waiting=1&days=30&evil=1&model2=x&stage=DROP TABLE"));
    assert.deepEqual(q, { model: "COURAGE", colour: "black", budget: "total_40k_50k", city: "metn", waiting: true, days: 30 });
    assert.deepEqual(parseInsightQuery(new URLSearchParams(toSearch(q).slice(1))), q);
    assert.equal(labHref({ model: "COURAGE" }), "/insights/lab?model=COURAGE");
  });
  test("matches exactly the people counted", () => {
    assert.equal(matchesQuery(rami, { model: "COURAGE", colour: "black" }, NOW), true);
    assert.equal(matchesQuery(lina, { model: "COURAGE", colour: "black" }, NOW), false, "she refused black");
    assert.equal(matchesQuery(lina, { rejectedColour: "black" }, NOW), true);
    assert.equal(matchesQuery(rami, { owner: "none" }, NOW), true);
    assert.equal(matchesQuery(lina, { owner: "none" }, NOW), false);
    assert.equal(matchesQuery(rami, { days: 7 }, NOW), true);
    assert.equal(matchesQuery(rami, { model: "COURAGE", alsoModel: "FREE_318" }, NOW), true);
  });
});

describe("the analysis pages", () => {
  test("models: people once per car, main car, links", () => {
    const courage = modelsTable(people, NOW).find((r) => r.code === "COURAGE")!;
    assert.equal(courage.people, 2);
    assert.equal(courage.price, 2);
    assert.equal(courage.buying, 1);
    const d = modelDetail("COURAGE", people, ROWS.signals, personOf, NOW);
    assert.deepEqual(d.alsoAsked.map((c) => [c.key, c.n, c.q]), [["FREE_318", 1, { anyModel: "COURAGE", alsoModel: "FREE_318" }]]);
    assert.equal(d.weekly.reduce((a, b) => a + b, 0) >= 2, true);
  });
  test("colours: the share is over people who named a colour; strict drops conversation-tied ones", () => {
    const loose = colourMatrix(ROWS.observations!, people, personOf, false, { COURAGE: { now: 3, inbound: 1, colours: [{ key: "black", n: 2 }] } }).find((r) => r.code === "COURAGE")!;
    assert.equal(loose.known, 2);
    assert.equal(loose.unknown, 0);
    assert.deepEqual(loose.exterior.map((c) => [c.family, c.people, c.share, c.stockNow]), [["black", 1, 0.5, 2], ["white", 1, 0.5, 0]]);
    assert.deepEqual(loose.rejected.map((c) => [c.key, c.n]), [["black", 1]]);
    const strict = colourMatrix(ROWS.observations!, people, personOf, true, null).find((r) => r.code === "COURAGE")!;
    assert.deepEqual(strict.exterior.map((c) => c.family), ["white"]);
    assert.equal(strict.stockNow, null, "no CRM: unknown, never 0");
  });
  test("conversations: rising needs at least 5 people", () => {
    const v = conversationsView(people, ROWS.signals, personOf, NOW);
    assert.equal(v.rising.length, 0);
    assert.equal(v.questions.find((q) => q.key === "PRICE")?.n, 2);
  });
  test("channels count a person on every channel they used", () => {
    const v = channelsView(people);
    assert.equal(v.find((c) => c.channel === "whatsapp")?.people, 2);
    assert.equal(v.find((c) => c.channel === "instagram")?.people, 1);
    assert.deepEqual(v.find((c) => c.channel === "whatsapp")?.firstTouch.map((t) => [t.key, t.n]).sort(), [["ad", 1], ["direct", 1]]);
  });
  test("quality: coverage over everyone, colours by how they were tied", () => {
    const q = qualityView(people, ROWS.observations!, () => true);
    assert.equal(q.coverage.find((c) => c.key === "budget")?.n, 1);
    assert.equal(q.coverage.find((c) => c.key === "budget")?.share, 0.5);
    assert.equal(q.colourFacts, 3);
    assert.equal(q.unboundColours, 0);
  });
});

describe("the CSV and the pages", () => {
  test("cells a spreadsheet would run are defused", () => {
    const csv = labCsv([{ ...rami, name: "=HYPERLINK(1)", phone: "96171222333" }]);
    assert.match(csv, /'=HYPERLINK\(1\)/);
  });
  test("every new page checks the role and has the section links", () => {
    for (const p of ["models/page.tsx", "models/[code]/page.tsx", "colours/page.tsx", "conversations/page.tsx", "channels/page.tsx", "lab/page.tsx", "quality/page.tsx"]) {
      const src = readFileSync(join(process.cwd(), "app/insights", p), "utf8");
      assert.match(src, /requireInsightsAccess\(/, p);
      assert.match(src, /<InsightsNav current=/, p);
    }
  });
  test("the summary table holds no name and no phone", () => {
    const sql = readFileSync(join(process.cwd(), "database/migrations/023_insight_people.sql"), "utf8");
    const create = sql.slice(sql.indexOf("create table"), sql.indexOf(");"));
    assert.doesNotMatch(create, /\bname\b|\bphone\b|display/);
    assert.match(sql, /enable row level security/);
    assert.doesNotMatch(sql, /create policy/i);
  });
});
