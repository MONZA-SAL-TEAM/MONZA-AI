/**
 * The leads as the Monza S.A.L. app shows them (lib/leads/feed.ts). Invented rows — no real
 * customer appears in a test.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { leadFeedRow, leadsFeed, LEADS_FEED_CAP } from "@/lib/leads/feed";
import { allowsRule, apiRuleOf, effectiveAccess, PRESETS } from "@/lib/access/access";
import type { Person } from "@/lib/leads/people";

const person = (over: Partial<Person> = {}): Person => ({
  id: "lead:L1",
  name: "Test One",
  phone: "9613418593",
  threads: [
    { threadId: "t-old", channel: "whatsapp", brand: "monza", lastMessageAt: "2026-11-20T10:00:00Z", lastInboundAt: "2026-11-20T09:00:00Z", unread: 0 },
    { threadId: "t-new", channel: "instagram", brand: "voyah", lastMessageAt: "2026-11-27T10:00:00Z", lastInboundAt: "2026-11-27T10:00:00Z", unread: 1 },
  ],
  source: "Ad click",
  sourceDetail: "Voyah COURAGE",
  sourceRef: "120200000000001",
  interests: ["VOYAH Courage"],
  alerts: [],
  firstSeenAt: "2026-11-20T09:00:00Z",
  lastSeenAt: "2026-11-27T10:00:00Z",
  crm: null,
  ...over,
});

describe("the leads feed for the Monza S.A.L. app (Samer, 2026-11-28)", () => {
  test("a row says who, where and what they asked about — and which chat to open", () => {
    const row = leadFeedRow(person());
    assert.deepEqual(row, {
      id: "lead:L1",
      name: "Test One",
      phone: "9613418593",
      channels: ["instagram", "whatsapp"],
      brands: ["voyah", "monza"],
      cars: ["VOYAH Courage"],
      source: "Ad click",
      sourceDetail: "Voyah COURAGE",
      firstSeenAt: "2026-11-20T09:00:00Z",
      lastSeenAt: "2026-11-27T10:00:00Z",
      waiting: true,
      alert: null,
      threadId: "t-new",
      stage: null,
      stageLabel: null,
      stageRank: null,
      mainCar: null,
      numberClass: "C",
      numberScore: 15,
      numberReasons: ["the original 03 prefix"],
    });
  });

  test("carries the stage and the car when the person is profiled, and the number's class with its reasons", () => {
    const facts = { stage: "pricing", stageLabel: "Asked price / terms", stageRank: 3, mainCar: "VOYAH Courage" };
    const row = leadFeedRow(person({ phone: "96170123123" }), facts);
    assert.deepEqual([row.stage, row.stageLabel, row.stageRank, row.mainCar], ["pricing", "Asked price / terms", 3, "VOYAH Courage"]);
    assert.deepEqual([row.numberClass, row.numberScore, row.numberReasons], ["S", 90, ["the same three digits twice"]]);
    // No phone (Instagram), or not profiled yet: nothing is claimed.
    const bare = leadFeedRow(person({ phone: null }));
    assert.deepEqual([bare.numberClass, bare.numberScore, bare.numberReasons, bare.stage], [null, null, [], null]);
    const feed = leadsFeed([person({ id: "lead:a" }), person({ id: "lead:b" })], new Map([["lead:b", facts]]));
    assert.deepEqual(feed.leads.map((l) => l.stage), [null, "pricing"]);
  });

  test("waiting = the customer wrote last; a chat we answered is not waiting; an open alert names its chat", () => {
    const answered = person({ threads: [{ threadId: "t", channel: "whatsapp", brand: "monza", lastMessageAt: "2026-11-27T11:00:00Z", lastInboundAt: "2026-11-27T10:00:00Z", unread: 0 }] });
    assert.equal(leadFeedRow(answered).waiting, false);
    const never = person({ threads: [{ threadId: "t", channel: "whatsapp", brand: "monza", lastMessageAt: "2026-11-27T11:00:00Z", lastInboundAt: null, unread: 0 }] });
    assert.equal(leadFeedRow(never).waiting, false);
    const alerted = person({ alerts: [{ kind: "PRICE", reason: null, createdAt: "2026-11-26T08:00:00Z", threadId: "t-old" }, { kind: "TEST_DRIVE", reason: null, createdAt: "2026-11-27T08:00:00Z", threadId: "t-old" }] });
    assert.deepEqual([leadFeedRow(alerted).alert, leadFeedRow(alerted).threadId], ["TEST_DRIVE", "t-old"]);
  });

  test("never a customer's words, never an owner, and no phone where the channel gives none", () => {
    const row = leadFeedRow(person({ phone: null, alerts: [{ kind: "PRICE", reason: "asked the price of the Courage in black", createdAt: "2026-11-27T08:00:00Z", threadId: "t-new" }] }));
    assert.equal(row.phone, null);
    const text = JSON.stringify(row);
    assert.doesNotMatch(text, /asked the price|"reason"|owner|assigned|crm|sourceRef/i);
  });

  test("newest activity first; a cut list still says how many there are", () => {
    const many = Array.from({ length: LEADS_FEED_CAP + 5 }, (_, i) => person({ id: `lead:${i}`, lastSeenAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString() }));
    const feed = leadsFeed(many);
    assert.equal(feed.total, LEADS_FEED_CAP + 5);
    assert.equal(feed.leads.length, LEADS_FEED_CAP);
    assert.equal(feed.leads[0].id, `lead:${LEADS_FEED_CAP + 4}`);
    assert.deepEqual(leadsFeed([]), { total: 0, leads: [] });
  });

  test("the route is open to the people who may open Customers, and to nobody set without it", () => {
    const rule = apiRuleOf("/api/leads/feed", "GET")!;
    assert.deepEqual(rule, { page: "customers" });
    const withPages = (pages: readonly string[]) =>
      effectiveAccess({ userId: "u", isAdmin: false, blocked: false, preset: "custom", pages: [...pages], actions: [] } as Parameters<typeof effectiveAccess>[0]);
    assert.equal(allowsRule(withPages(PRESETS.viewer.pages), rule), true);
    assert.equal(allowsRule(withPages(["inbox"]), rule), false);
  });
});
