import { test } from "node:test";
import assert from "node:assert/strict";
import { salesInPeriod, testDrivesTaken, type PersonCrm } from "@/lib/insights/crm";

const w = { sinceMs: Date.parse("2026-10-01T00:00:00Z"), untilMs: Date.parse("2026-10-31T23:59:59Z") };
const person = (wonAt: string | null): PersonCrm => ({ outcome: wonAt ? "won" : "quoted", firstOrderAt: null, quoteSentAt: null, wonAt, models: [] });

test("sales are counted by the CRM's sale date, every sale — not only buyers who chatted", () => {
  const r = salesInPeriod(
    [
      { model: "Free", status: "paid", at: "2026-10-05" },
      { model: "Free", status: "delivered", at: "2026-10-20" },
      { model: "Free", status: "paid", at: "2026-09-30" }, // before the window
      { model: "Free", status: "reserved", at: "2026-10-06" }, // not a sale
      { model: "Free", status: "paid", at: null }, // undated: reported, never counted
    ],
    {},
    new Map(),
    w
  );
  assert.deepEqual(r, { all: 2, undated: 1, fromChats: 0, fromAds: 0 });
});

test("a buyer counts as from the chats only if they wrote BEFORE the sale, once even with two phones", () => {
  const twoPhones = person("2026-10-10");
  const r = salesInPeriod(
    [],
    { "96170000001": twoPhones, "96170000002": twoPhones, "96170000003": person("2026-10-12"), "96170000004": person("2026-10-15") },
    new Map([
      ["96170000001", { firstAt: "2026-09-01T10:00:00Z", firstTouch: "ad_click" }],
      ["96170000002", { firstAt: "2026-09-01T10:00:00Z", firstTouch: "ad_click" }],
      ["96170000003", { firstAt: "2026-10-01T10:00:00Z", firstTouch: "direct" }],
      ["96170000004", { firstAt: "2026-10-20T10:00:00Z", firstTouch: "ad_click" }], // wrote after buying
    ]),
    w
  );
  assert.equal(r.fromChats, 2);
  assert.equal(r.fromAds, 1);
});

test("CRM test drives count people once, in the window, matched by mobile", () => {
  const n = testDrivesTaken(
    [
      { phone: "96170000001", at: "2026-10-03T09:00:00Z" },
      { phone: "96170000001", at: "2026-10-04T09:00:00Z" },
      { phone: "96170000002", at: "2026-11-02T09:00:00Z" },
      { phone: "96170000009", at: "2026-10-03T09:00:00Z" },
    ],
    new Set(["96170000001", "96170000002"]),
    w
  );
  assert.equal(n, 1);
});
