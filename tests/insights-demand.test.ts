/**
 * The stored demand record (lib/insights/demand.ts, migration 027): counts with NO client data, people once
 * per day and once per month, refusals never counted as wishes, named apart from context.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beirutDay, demandRows } from "@/lib/insights/demand";
import { demandTable } from "@/lib/insights/demand-view";
import type { ObservationRow, SignalRow } from "@/lib/insights/insights";

const sig = (conv: string, at: string, models: string[] = [], extra: Partial<SignalRow> = {}): SignalRow => ({
  account_id: "wa-monza", brand: "voyah", channel: "whatsapp", conversation_id: conv, at, language: "en", intents: ["PRICE"], models, weak_models: [], colour: null, has_media: false, alert_kind: null, alert_tags: [], offered: [], silenced: [], ...extra,
});
const ob = (conv: string, at: string, value: string, stance: string, extra: Partial<ObservationRow> = {}): ObservationRow => ({
  conversation_id: conv, at, kind: "colour", stance, model: "COURAGE", binding: "same_clause", part: "exterior", value, detail: null, external_message_id: `${conv}-${at}`, ...extra,
});
const SIGNALS = [
  sig("c1", "2026-10-01T09:00:00Z", ["COURAGE"]),
  sig("c1", "2026-10-01T10:00:00Z", ["COURAGE"]),
  sig("c1", "2026-10-03T09:00:00Z", [], { context_models: ["COURAGE"] }),
  sig("c2", "2026-10-03T09:00:00Z", [], { context_models: ["COURAGE"], ad_model: "COURAGE" }),
];
const OBS = [ob("c1", "2026-10-01T09:00:00Z", "black", "wants"), ob("c2", "2026-10-03T09:00:00Z", "white", "rejects")];
const personOf = (c: string) => `chat:${c}`;

describe("the demand record", () => {
  const days = demandRows(SIGNALS, OBS, personOf);
  const months = demandRows(SIGNALS, OBS, personOf, undefined, "month");
  const find = (rows: typeof days, dimension: string, value: string, day?: string) => rows.filter((r) => r.dimension === dimension && r.value === value && (!day || r.day === day));

  test("no client data: nothing in a row points to a person or a chat", () => {
    const json = JSON.stringify([...days, ...months]);
    assert.ok(!json.includes("chat:") && !json.includes("c1") && !json.includes("c2"));
    for (const r of [...days, ...months]) assert.deepEqual(Object.keys(r).sort(), ["brand", "channel", "day", "dimension", "messages", "model", "people", "period", "value"]);
  });
  test("people once per day; messages counted apart", () => {
    const d = find(days, "car_named", "COURAGE", "2026-10-01")[0];
    assert.deepEqual([d.people, d.messages], [1, 2]);
  });
  test("a month counts each person once, however many days they wrote", () => {
    const m = find(months, "car_interest", "COURAGE")[0];
    assert.equal(m.day, "2026-10-01");
    assert.equal(m.people, 2);
    assert.equal(find(months, "car_named", "COURAGE")[0].people, 1);
    assert.equal(find(months, "car_context", "COURAGE")[0].people, 2, "per message: c1 also asked by context on another day");
    assert.equal(find(months, "ad_car", "COURAGE")[0].people, 1);
  });
  test("a refused colour is never counted as wanted", () => {
    assert.equal(find(days, "colour_wanted", "white").length, 0);
    assert.equal(find(days, "colour_rejected", "white")[0].people, 1);
    assert.equal(find(days, "colour_wanted", "black")[0].model, "COURAGE");
  });
  test("days are Beirut days", () => {
    assert.equal(beirutDay("2026-10-01T22:30:00Z"), "2026-10-02");
  });
  test("the table adds brands and channels, months across", () => {
    const t = demandTable(months.map((r) => ({ ...r })), "car_interest");
    assert.deepEqual(t.months, ["2026-10-01"]);
    assert.deepEqual(t.lines.map((l) => [l.label, l.values]), [["VOYAH Courage", [2]]]);
  });
  test("the stored table holds no person and is tied to no customer table", () => {
    const sql = readFileSync(join(process.cwd(), "database/migrations/027_insight_demand_daily.sql"), "utf8");
    const create = sql.slice(sql.indexOf("create table"), sql.indexOf(");"));
    assert.doesNotMatch(create, /references|person|lead|conversation|phone|name/i);
    assert.match(sql, /enable row level security/);
    assert.doesNotMatch(sql, /create policy/i);
  });
});
