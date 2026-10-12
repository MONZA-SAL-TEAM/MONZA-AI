/**
 * One client's profile (lib/insights/profile.ts), the CRM's cars (lib/insights/crm.ts), and what clients
 * tell us on the overview (buildInsights → profile). Samer, 2026-10-12: "I want to know all data of
 * clients and leads … connected to the client is the car."
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildClientProfile, parsePersonKey, type ProfileRows } from "@/lib/insights/profile";
import { colourFamily, crmModelCode, stockByModel, type CrmPurchase, type CrmResult } from "@/lib/insights/crm";
import { buildInsights, type ObservationRow, type SignalRow } from "@/lib/insights/insights";

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const L1 = "33333333-3333-4333-8333-333333333333";

const signal = (conv: string, at: string, intents: string[], models: string[] = []): SignalRow => ({
  account_id: "wa-monza", brand: "monza", channel: "whatsapp", conversation_id: conv, at, language: "arabizi", intents, models, weak_models: [], colour: null, has_media: false, alert_kind: null, alert_tags: [], offered: [], silenced: [],
});
const fact = (conv: string, at: string, kind: string, value: string, extra: Partial<ObservationRow> = {}): ObservationRow => ({
  conversation_id: conv, at, kind, stance: "mentioned", model: null, binding: null, part: null, value, detail: null, ...extra,
});

const ROWS: ProfileRows = {
  conversations: [{ id: C1, account_id: "wa-monza", brand: "monza", peer_external_id: "96171222333", peer_display: "Rami", created_at: "2026-06-01T09:00:00Z" }],
  accountChannel: { "wa-monza": "whatsapp" },
  lead: { id: L1, display_name: "Rami K", phone: "+961 71 222 333" },
  signals: [
    signal(C1, "2026-06-01T09:00:00Z", ["PRICE"], ["COURAGE"]),
    signal(C1, "2026-08-10T09:00:00Z", ["COLOUR"], ["COURAGE"]),
    signal(C1, "2026-08-10T09:05:00Z", ["FINANCING"], ["FREE_318"]),
  ],
  observations: [
    fact(C1, "2026-06-01T09:00:00Z", "budget", "total_40k_50k", { amount_min: 40000, amount_max: 40000, currency: "USD", amount_kind: "total" }),
    fact(C1, "2026-08-10T09:00:00Z", "colour", "black", { stance: "wants", model: "COURAGE", part: "exterior", detail: "Pearl Black" }),
    fact(C1, "2026-08-10T09:00:00Z", "colour", "white", { stance: "rejects", model: "COURAGE", part: "exterior", detail: "Pearl White" }),
    fact(C1, "2026-08-10T09:05:00Z", "city", "metn", { detail: "Metn" }),
    fact(C1, "2026-08-10T09:05:00Z", "model", "dream", { stance: "rejects", model: "DREAM" }),
  ],
  alerts: [{ conversation_ref: C1, kind: "FINANCING", status: "open", created_at: "2026-08-10T09:06:00Z" }],
  touchpoints: [{ source_kind: "ad", source_ref: "123", headline: "Voyah COURAGE", occurred_at: "2026-06-01T09:00:00Z" }],
};
const BOUGHT: CrmResult<CrmPurchase[]> = {
  state: "ok",
  data: [{ customerName: "Rami Khoury", model: "COURAGE", carLabel: "Voyah courage 2025", exterior: "black", interior: "beige", orderStatus: "delivered", carStatus: "delivered", at: "2026-09-01T00:00:00Z", deliveredAt: "2026-09-05T00:00:00Z" }],
};

describe("the person key", () => {
  test("only lead:<uuid> and chat:<uuid> are accepted", () => {
    assert.deepEqual(parsePersonKey(`lead:${L1}`), { kind: "lead", id: L1 });
    assert.deepEqual(parsePersonKey(`chat:${C1}`), { kind: "chat", id: C1 });
    for (const bad of ["lead:1", `crm:${C1}`, `lead:${C1}; drop table`, "", "chat:AAAAAAAA-1111-4111-8111-111111111111"]) assert.equal(parsePersonKey(bad), null, bad);
  });
});

describe("one client's profile", () => {
  const p = buildClientProfile(`lead:${L1}`, ROWS, BOUGHT);

  test("who: the lead's name, the mobile, a customer because the CRM sold them a car", () => {
    assert.equal(p.name, "Rami K");
    assert.equal(p.phone, "96171222333");
    assert.equal(p.type, "customer");
    assert.equal(p.firstTouch?.label, "An ad: Voyah COURAGE");
  });

  test("cars: the one named most is the main one; a refused car is kept apart", () => {
    assert.equal(p.models.primary, buildClientProfile(`lead:${L1}`, ROWS, BOUGHT).models.primary);
    assert.match(p.models.primary ?? "", /Courage/i);
    assert.ok(p.models.rejected.some((m) => /Dream/i.test(m)));
  });

  test("colours with their stance, and the facts in words", () => {
    assert.ok(p.colours.wants.some((c) => c.startsWith("Pearl Black")));
    assert.ok(p.colours.rejects.some((c) => c.startsWith("Pearl White")));
    assert.ok(!p.colours.wants.some((c) => c.includes("White")), "a refusal is never a wish");
    const budget = p.facts.find((f) => f.kind === "budget");
    assert.deepEqual(budget?.items, ["Budget $40,000"]);
    assert.deepEqual(p.facts.find((f) => f.kind === "city")?.items, ["Lives in Metn"]);
  });

  test("the journey is newest first, mixes messages, alerts and the CRM order, and opens the chat", () => {
    assert.equal(p.journey[0].kind, "crm");
    assert.ok(p.journey.some((j) => j.kind === "alert" && j.details.includes("Still open")));
    const msg = p.journey.find((j) => j.kind === "message")!;
    assert.ok(msg.threadId && msg.threadId.includes(C1));
    for (let i = 1; i < p.journey.length; i++) assert.ok(Date.parse(p.journey[i - 1].at) >= Date.parse(p.journey[i].at));
    assert.equal(p.waiting, "FINANCING");
  });

  test("a CRM that could not be read stays 'unavailable' — never 'no car'", () => {
    const q = buildClientProfile(`lead:${L1}`, ROWS, { state: "unavailable" });
    assert.equal(q.crm.state, "unavailable");
    assert.equal(q.type, "returning", "two months of silence, then back");
  });
});

describe("the CRM's own words", () => {
  test("models and colours map onto the bot's", () => {
    assert.equal(crmModelCode("free"), "FREE_318");
    assert.equal(crmModelCode("m hero 2"), "MHERO_2");
    assert.equal(crmModelCode("m hero 1"), "MHERO_1");
    assert.equal(crmModelCode("passion l"), "PASSION_L");
    assert.equal(crmModelCode("passion"), "PASSION");
    assert.equal(crmModelCode("something else"), null);
    assert.equal(colourFamily("Pearl Black"), "black");
    assert.equal(colourFamily("grey"), "grey");
    assert.equal(colourFamily(null), null);
  });

  test("stock: cars that can be sold now, by colour, and those on the way", () => {
    const s = stockByModel([
      { model: "courage", exterior_color: "black", interior_color: null, status: "in_stock" },
      { model: "courage", exterior_color: "black", interior_color: null, status: "showroom" },
      { model: "courage", exterior_color: "grey", interior_color: null, status: "available" },
      { model: "courage", exterior_color: "white", interior_color: null, status: "inbound" },
      { model: "courage", exterior_color: "white", interior_color: null, status: "sold" },
    ]);
    assert.deepEqual(s.get("COURAGE"), { now: 3, inbound: 1, colours: [{ key: "black", n: 2 }, { key: "grey", n: 1 }] });
  });
});

describe("what clients tell us, on the overview", () => {
  test("each person counted once, with their LATEST budget; the denominator is who said it", () => {
    const rows = {
      signals: [signal(C1, "2026-10-01T09:00:00Z", ["PRICE"], ["COURAGE"]), signal(C1, "2026-10-05T09:00:00Z", ["PRICE"]), signal(C2, "2026-10-06T09:00:00Z", ["GREETING"])],
      observations: [
        fact(C1, "2026-10-01T09:00:00Z", "budget", "total_30k_40k", { amount_min: 35000, amount_max: 35000, currency: "USD", amount_kind: "total" }),
        fact(C1, "2026-10-05T09:00:00Z", "budget", "total_40k_50k", { amount_min: 45000, amount_max: 45000, currency: "USD", amount_kind: "total" }),
        fact(C1, "2026-10-05T09:00:00Z", "competitor", "byd", { stance: "compared", detail: "BYD" }),
      ],
      conversations: [
        { id: C1, account_id: "wa-monza", brand: "monza", peer_external_id: "96171222333", peer_display: "Rami", created_at: null },
        { id: C2, account_id: "wa-monza", brand: "monza", peer_external_id: "96171999888", peer_display: "Lina", created_at: null },
      ],
      leads: [],
      leadConversations: [],
      alerts: [],
    };
    const ins = buildInsights(rows, { days: 0, now: "2026-10-12T00:00:00Z" });
    assert.deepEqual(ins.profile.budget.map((c) => [c.key, c.n]), [["total_40k_50k", 1]]);
    assert.equal(ins.profile.known.budget, 1);
    assert.deepEqual(ins.profile.competitors.map((c) => [c.label, c.n]), [["BYD", 1]]);
    const rami = ins.clients.find((c) => c.name === "Rami")!;
    assert.equal(rami.budget, "$45,000");
    assert.deepEqual(rami.otherBrands, ["Compared with BYD"]);
  });
});
