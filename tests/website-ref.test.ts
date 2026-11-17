/**
 * The websites' Ref code (owner, 17 Nov 2026).
 *
 * Every WhatsApp button on voyahlebanon.com, mherolebanon.com and monzasal.com
 * ends the pre-filled message with "(Ref V-7K2Q9M)" (V / M / S = the site). Two
 * things under test:
 *
 *  1. It is read as a WEBSITE arrival, split by site — and never believed when
 *     it is not exactly our code, and never over Meta's own ad referral.
 *  2. It changes NOTHING the sales engine does: a message with the code gets
 *     exactly the answer, the alerts and the actions the same message gets
 *     without it. The code must never read as a car, a number or a question.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { classifyArrival, websiteRefIn, websiteTouchKey } from "@/lib/leads/attribution";
import { runConversation } from "@/lib/wasales/flow";
import { MONZA_KNOWLEDGE } from "@/lib/wasales/knowledge";
import { loadCatalog } from "@/lib/wasales/catalog";
import { liveMedia } from "@/tests/_live-library";
import type { EngineInput } from "@/lib/wasales/engine";

describe("website Ref code → where the chat came from", () => {
  test("an exact code is a website arrival, with its site", () => {
    const a = classifyArrival(null, "Hello MONZA SAL, I'm interested in purchasing a VOYAH.\n(Ref V-48V58T)");
    assert.equal(a.kind, "website");
    assert.equal(a.ref, "V-48V58T");
    assert.equal(a.headline, "voyahlebanon.com");
    assert.equal(a.certain, true);
    assert.deepEqual(a.raw, { ref_code: "V-48V58T", site: "voyahlebanon.com" });
    assert.equal(classifyArrival(null, "x (Ref M-5K8WYL)").headline, "mherolebanon.com");
    assert.equal(classifyArrival(null, "x (Ref S-BY5HXM)").headline, "monzasal.com");
  });

  test("anything that is not exactly our code is not believed", () => {
    for (const text of [
      "Hello, I want the Free",
      "(Ref v-48v58t)", // lower case: not what the site writes
      "(Ref X-48V58T)", // unknown site
      "(Ref V-48V5)", // too short
      "(Ref V-O0I1AB)", // letters the site never uses
      "Ref V-48V58T", // no brackets
      "(Ref: web-mhero-1)", // the old tag says a website, not which visit
    ]) {
      assert.equal(websiteRefIn(text), null, text);
      assert.equal(classifyArrival(null, text).kind, "direct", text);
    }
  });

  test("Meta's ad referral wins over the code: an ad click is fact", () => {
    const a = classifyArrival(
      { source: "ads", ctwaClid: "clid-1", ref: null, headline: "Voyah COURAGE", sourceUrl: null, storyId: null, raw: {} } as never,
      "Hi (Ref V-48V58T)"
    );
    assert.equal(a.kind, "ad_click");
  });

  test("the insights key splits websites by site", () => {
    assert.equal(websiteTouchKey("V-48V58T"), "website_voyah");
    assert.equal(websiteTouchKey("M-5K8WYL"), "website_mhero");
    assert.equal(websiteTouchKey("S-BY5HXM"), "website_monza");
    assert.equal(websiteTouchKey(null), "website");
    assert.equal(websiteTouchKey("whatever"), "website");
  });
});

describe("the sales engine ignores the code", () => {
  const DEPS = { knowledge: MONZA_KNOWLEDGE, catalog: loadCatalog(), media: liveMedia, ttlHours: 72 };
  const T0 = Date.parse("2026-10-06T09:00:00.000Z"); // a Tuesday, within hours
  const SEND = { channel: "whatsapp" as const, autoSendEnabled: true, replyWindowOpen: true, humanLock: false, liveSending: true, attachmentsSupported: true, linkOversize: true };
  const talk = (messages: string[]) => {
    const inputs: EngineInput[] = messages.map((text, i) => ({
      text,
      hasMedia: false,
      brand: "monza",
      channel: "whatsapp",
      conversationIsNew: i === 0,
      now: new Date(T0 + i * 60_000).toISOString(),
    }));
    return runConversation(inputs, DEPS, SEND).turns;
  };

  // The three sites' own pre-filled messages, and a follow-up question.
  const CASES: Array<[string, string]> = [
    ["Hello MONZA SAL, I'm interested in purchasing a VOYAH.", "V-48V58T"],
    ["Hello Monza SAL, I'm interested in the MHERO 1.", "M-5K8WYL"],
    ["Hello Monza SAL, I'm interested in the MHERO 2.", "M-2Z9QXA"],
    ["Hello Monza, I’m interested in VOYAH.", "S-BY5HXM"],
    ["Hello Monza, I’m interested in the Free 318. How much is it?", "S-7K2Q9M"],
    ["hi", "V-DREAM2"],
  ];
  for (const [text, code] of CASES) {
    test(`"${text}" + (Ref ${code}) is answered exactly as without it`, () => {
      const plain = talk([text, "what colours do you have?"]);
      const withRef = talk([`${text}\n(Ref ${code})`, "what colours do you have?"]);
      assert.deepEqual(JSON.parse(JSON.stringify(withRef)), JSON.parse(JSON.stringify(plain)));
    });
  }
});

describe("stripWebsiteRef", () => {
  test("removes only our own tag", async () => {
    const { stripWebsiteRef } = await import("@/lib/wasales/website-ref");
    assert.equal(stripWebsiteRef("Hello, the MHERO 1.\n(Ref M-5K8WYL)"), "Hello, the MHERO 1.");
    assert.equal(stripWebsiteRef("Hello Monza, I’m interested in VOYAH.\nRef: web-voyah"), "Hello Monza, I’m interested in VOYAH.");
    assert.equal(stripWebsiteRef("is (Ref M-5K8WYL) the code?"), "is (Ref M-5K8WYL) the code?"); // not at a line end: the customer's words
    assert.equal(stripWebsiteRef("my budget is 5k"), "my budget is 5k");
    assert.equal(stripWebsiteRef(""), "");
    assert.equal(stripWebsiteRef(null), null);
  });
});
