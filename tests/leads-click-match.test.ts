/**
 * Inferring that a WhatsApp chat began with a tap on a site (lib/leads/click-match.ts).
 * Invented times and ids.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { carAgreement, carWord, inferWebsiteTouches, mergeTaps, windowReport, TAP_WINDOW_MS } from "@/lib/leads/click-match";

const T0 = Date.UTC(2026, 9, 1, 10, 0, 0);
const s = (sec: number) => T0 + sec * 1000;
const tap = (sec: number, site = "voyahlebanon.com", vehicle: string | null = null, sessionId: string | null = null) => ({ at: s(sec), site, vehicle, sessionId });
const msg = (leadId: string, sec: number, firstTouch: "direct" | "ad_click" | "social_post" | "website" | "staff_recorded" = "direct", interests: string[] = []) => ({ leadId, at: s(sec), firstTouch, interests });

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

  test("two chats after one tap: neither is attributed", () => {
    assert.deepEqual(inferWebsiteTouches([msg("late", 90), msg("early", 30)], [tap(0)]), []);
  });

  test("an ad chat competing for the tap blocks the direct one, and is never relabelled itself", () => {
    assert.deepEqual(inferWebsiteTouches([msg("ad", 20, "ad_click"), msg("direct", 40)], [tap(0)]), []);
  });

  test("two taps before one chat: we cannot say which, so nothing", () => {
    assert.deepEqual(inferWebsiteTouches([msg("L1", 200)], [tap(0, "monzasal.com"), tap(150, "voyahlebanon.com")]), []);
  });

  test("two taps and two chats far enough apart pair off cleanly", () => {
    const r = inferWebsiteTouches([msg("A", 40), msg("B", 1040)], [tap(0, "voyahlebanon.com"), tap(1000, "mherolebanon.com")]);
    assert.deepEqual(r.map((x) => [x.leadId, x.site]), [["A", "voyahlebanon.com"], ["B", "mherolebanon.com"]]);
  });

  test("repeated taps by one visitor do not explain two chats", () => {
    const r = inferWebsiteTouches([msg("A", 30), msg("B", 60)], [tap(0), tap(5), tap(10)]);
    assert.equal(r.length, 0);
    assert.equal(inferWebsiteTouches([msg("A", 30)], [tap(0), tap(5), tap(10)]).length, 1);
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

describe("the car as a second witness", () => {
  test("site names and car keys reduce to the same word", () => {
    assert.equal(carWord("VOYAH Courage"), "courage");
    assert.equal(carWord("voyah-courage"), "courage");
    assert.equal(carWord("voyah-free-comp"), "free");
    assert.equal(carWord("MHERO 1"), "mhero 1");
    assert.equal(carWord("mhero-2"), "mhero 2");
  });

  test("a marque alone names no car", () => {
    for (const generic of ["VOYAH", "MHERO", "Monza", "", null]) assert.equal(carWord(generic), null);
  });

  test("agreement, disagreement and not knowing are three answers", () => {
    assert.equal(carAgreement("VOYAH Taishan", ["voyah-taishan", "voyah-dream"]), "matches");
    assert.equal(carAgreement("VOYAH Taishan", ["mhero-1"]), "differs");
    assert.equal(carAgreement("MHERO 1", ["mhero-2"]), "differs");
    assert.equal(carAgreement("VOYAH", ["voyah-taishan"]), "unknown");
    assert.equal(carAgreement("VOYAH Taishan", []), "unknown");
  });

  test("a chat about a different car than the page showed is not attributed", () => {
    assert.deepEqual(inferWebsiteTouches([msg("L1", 60, "direct", ["mhero-1"])], [tap(0, "voyahlebanon.com", "VOYAH Taishan")]), []);
  });

  test("a chat about the page's car says so", () => {
    const [r] = inferWebsiteTouches([msg("L1", 60, "direct", ["voyah-taishan"])], [tap(0, "voyahlebanon.com", "VOYAH Taishan")]);
    assert.equal(r.car, "matches");
    assert.match(r.explanation, /about the car that page showed/);
    assert.match(r.explanation, /not certain/);
  });

  test("no car on either side still attributes, as unknown", () => {
    const [r] = inferWebsiteTouches([msg("L1", 60)], [tap(0, "voyahlebanon.com", "VOYAH")]);
    assert.equal(r.car, "unknown");
  });
});

describe("windowReport", () => {
  test("a wider window finds more, and the chance column is reported beside it", () => {
    const messages = [msg("a", 50), msg("b", 1000 + 170), msg("c", 5000 + 500)];
    const taps = [tap(0), tap(1000), tap(5000)];
    const rows = windowReport(messages, taps, [1, 3, 5, 10]);
    assert.deepEqual(rows.map((r) => [r.minutes, r.inferred]), [[1, 1], [3, 2], [5, 2], [10, 3]]);
    assert.ok(rows.every((r) => r.byChance === 0));
  });
});
