/**
 * Inferring that a WhatsApp chat began with a tap on a site (lib/leads/click-match.ts).
 * Invented times and ids.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { inferWebsiteTouches, mergeTaps, TAP_WINDOW_MS } from "@/lib/leads/click-match";

const T0 = Date.UTC(2026, 9, 1, 10, 0, 0);
const s = (sec: number) => T0 + sec * 1000;
const tap = (sec: number, site = "voyahlebanon.com", vehicle: string | null = null, sessionId: string | null = null) => ({ at: s(sec), site, vehicle, sessionId });
const msg = (leadId: string, sec: number, firstTouch: "direct" | "ad_click" | "social_post" | "website" | "staff_recorded" = "direct") => ({ leadId, at: s(sec), firstTouch });

describe("mergeTaps", () => {
  test("a visitor tapping three times in a minute is one tap", () => {
    assert.equal(mergeTaps([tap(0), tap(5), tap(40)]).length, 1);
  });

  test("the same seconds on two sites are two taps", () => {
    assert.equal(mergeTaps([tap(0, "voyahlebanon.com"), tap(1, "mherolebanon.com")]).length, 2);
  });

  test("two visit ids on one site in the same minute are two visitors", () => {
    assert.equal(mergeTaps([tap(0, "voyahlebanon.com", null, "a"), tap(10, "voyahlebanon.com", null, "b")]).length, 2);
  });

  test("taps ten minutes apart are two taps", () => {
    assert.equal(mergeTaps([tap(0), tap(600)]).length, 2);
  });
});

describe("inferWebsiteTouches", () => {
  test("a first message a minute after a tap is inferred, and says it is not certain", () => {
    const [r, ...rest] = inferWebsiteTouches([msg("L1", 60)], [tap(0, "voyahlebanon.com", "VOYAH Taishan")]);
    assert.equal(rest.length, 0);
    assert.equal(r.leadId, "L1");
    assert.equal(r.site, "voyahlebanon.com");
    assert.equal(r.vehicle, "VOYAH Taishan");
    assert.equal(r.gapSeconds, 60);
    assert.equal(r.certain, false);
    assert.match(r.explanation, /not certain/);
  });

  test("a message BEFORE the tap is never attributed to it", () => {
    assert.deepEqual(inferWebsiteTouches([msg("L1", 0)], [tap(30)]), []);
  });

  test("a message after the window is not attributed", () => {
    assert.deepEqual(inferWebsiteTouches([msg("L1", TAP_WINDOW_MS / 1000 + 1)], [tap(0)]), []);
  });

  test("a chat Meta attributed to an ad keeps its source, however close the tap", () => {
    assert.deepEqual(inferWebsiteTouches([msg("L1", 20, "ad_click")], [tap(0)]), []);
    assert.deepEqual(inferWebsiteTouches([msg("L1", 20, "social_post")], [tap(0)]), []);
    assert.deepEqual(inferWebsiteTouches([msg("L1", 20, "staff_recorded")], [tap(0)]), []);
  });

  test("one tap explains one chat: the earlier message has it", () => {
    const r = inferWebsiteTouches([msg("late", 90), msg("early", 30)], [tap(0)]);
    assert.deepEqual(r.map((x) => x.leadId), ["early"]);
  });

  test("two taps and two chats pair off one to one", () => {
    const r = inferWebsiteTouches([msg("A", 40), msg("B", 100)], [tap(0, "voyahlebanon.com"), tap(70, "mherolebanon.com")]);
    assert.deepEqual(r.map((x) => [x.leadId, x.site]), [["A", "voyahlebanon.com"], ["B", "mherolebanon.com"]]);
  });

  test("the closest earlier tap is chosen over an older one", () => {
    const [r] = inferWebsiteTouches([msg("L1", 200)], [tap(0, "monzasal.com"), tap(150, "voyahlebanon.com")]);
    assert.equal(r.site, "voyahlebanon.com");
    assert.equal(r.gapSeconds, 50);
  });

  test("repeated taps by one visitor do not explain two chats", () => {
    const r = inferWebsiteTouches([msg("A", 30), msg("B", 60)], [tap(0), tap(5), tap(10)]);
    assert.equal(r.length, 1);
  });

  test("the gap is measured from the visitor's LAST tap", () => {
    const [r] = inferWebsiteTouches([msg("L1", 100)], [tap(0), tap(90)]);
    assert.equal(r.gapSeconds, 10);
  });

  test("no taps, or no direct chats, is an empty answer", () => {
    assert.deepEqual(inferWebsiteTouches([msg("L1", 10)], []), []);
    assert.deepEqual(inferWebsiteTouches([], [tap(0)]), []);
  });

  test("a narrower window can be asked for", () => {
    assert.equal(inferWebsiteTouches([msg("L1", 100)], [tap(0)], 60_000).length, 0);
    assert.equal(inferWebsiteTouches([msg("L1", 100)], [tap(0)], 120_000).length, 1);
  });
});
