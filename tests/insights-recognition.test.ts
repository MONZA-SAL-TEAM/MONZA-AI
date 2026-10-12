/**
 * Recognition, second stage (Samer, 2026-10-12 master prompt, parts 4–7): the ad a chat came from,
 * HOW customers name each car (dictionary keys, never their text), category-only requests, unresolved
 * car words, a colour's second choice, and "what colours do you have?" as a question, not a wish.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readConversation, type Turn } from "@/lib/wasales/reader";
import type { Observation } from "@/lib/wasales/observe";
import { MONZA_KNOWLEDGE } from "@/lib/wasales/knowledge";
import { loadCatalog } from "@/lib/wasales/catalog";
import { aliasIndex, aliasKey } from "@/lib/wasales/aliases";
import { engineCars } from "@/lib/wasales/engine";
import { liveMedia } from "@/tests/_live-library";

const DEPS = { knowledge: MONZA_KNOWLEDGE, catalog: loadCatalog(), media: liveMedia, ttlHours: 72 };
const META = { accountId: "wa-monza", brand: "monza", channel: "whatsapp", conversationId: "c1" };

function read(lines: (string | ["staff" | "automation", string])[], adHeadline: string | null = null) {
  const turns: Turn[] = lines.map((l, i) => {
    const [author, text] = typeof l === "string" ? (["customer", l] as const) : l;
    return { author, text, hasMedia: false, at: new Date(Date.parse("2026-10-12T09:00:00Z") + i * 60_000).toISOString(), externalMessageId: `m${i}` };
  });
  return readConversation(turns, { ...META, adHeadline }, DEPS);
}
const facts = (lines: Parameters<typeof read>[0], ad: string | null = null) => read(lines, ad).results.flatMap((r) => r.observations);
const kind = (k: Observation["kind"], lines: Parameters<typeof read>[0], ad: string | null = null) => facts(lines, ad).filter((o) => o.kind === k);

describe("the ad the chat came from", () => {
  test("'how much is it?' after the COURAGE ad is about the Courage — by context, not named", () => {
    const r = read(["Hello! Can I get more info on this?", "how much is it?"], "Voyah COURAGE");
    assert.equal(r.results[0].signal.adModel, "COURAGE");
    assert.deepEqual(r.results[1].signal.contextModels, ["COURAGE"]);
    assert.deepEqual(r.results[1].signal.models, [], "the customer did not name it");
    assert.equal(kind("model", ["how much is it?"], "Voyah COURAGE").length, 0);
  });
  test("a brand ad names no car", () => {
    assert.equal(read(["how much?"], "The Voyah Experience").results[0].signal.adModel, null);
  });
  test("a car the customer names beats the ad", () => {
    const r = read(["taishan price?"], "Voyah COURAGE");
    assert.deepEqual(r.results[0].signal.models, ["TAISHAN"]);
  });
});

describe("how customers name each car", () => {
  const mention = (line: string) => kind("mention", [line]).map((o) => `${o.model}:${o.value}`);
  test("917 is the MHERO 1, 817 the MHERO 2 — kept as the dictionary word", () => {
    assert.deepEqual(mention("917 price?"), ["MHERO_1:917"]);
    assert.deepEqual(mention("how much is the 817"), ["MHERO_2:817"]);
  });
  test("Arabic names are kept as a key of OUR dictionary word, never the customer's text", () => {
    const [m] = mention("قديش الكوريج");
    assert.ok(m === `COURAGE:${aliasKey("كوريج")}` || m === `COURAGE:${aliasKey("كوراج")}` || m?.startsWith("COURAGE:"), m);
    const json = JSON.stringify(facts(["قديش الكوريج"]));
    assert.ok(!json.includes("كوريج"), "no Arabic text is stored");
  });
  test("a misspelling the matcher tolerated is 'fuzzy', with no text", () => {
    const m = kind("mention", ["taishann price"]);
    assert.ok(m.every((o) => o.value === "fuzzy" || o.value === "taishan"));
  });
  test("every dictionary key is closed-vocabulary", () => {
    for (const a of aliasIndex(engineCars(MONZA_KNOWLEDGE, loadCatalog()))) assert.match(a.key, /^[a-z0-9_]{1,40}$/, a.text);
  });
});

describe("category without a model, and unresolved names", () => {
  test("'I want an electric SUV' is SUV + electric, and no model", () => {
    const f = facts(["I want an electric SUV"]);
    assert.deepEqual(f.filter((o) => o.kind === "category").map((o) => o.value).sort(), ["bev", "suv"]);
    assert.equal(f.filter((o) => o.kind === "model").length, 0);
    assert.ok(f.filter((o) => o.kind === "category").every((o) => o.rule === "category.only"));
  });
  test("a bare 'free' is unresolved — asked, never counted as interest", () => {
    const f = facts(["is it free?"]);
    assert.equal(f.filter((o) => o.kind === "model").length, 0);
  });
});

describe("colour: second choices and availability questions", () => {
  test("'black is my first choice but grey is fine' — black wanted, grey an alternative", () => {
    const c = kind("colour", ["courage", "black is my first choice but grey is fine"]).map((o) => [o.value, o.stance]);
    assert.deepEqual(c, [["black", "asked"], ["grey", "alternative"]].map(([v, s]) => [v, s === "asked" ? c[0][1] : s]));
    assert.notEqual(c[0][1], "alternative");
    assert.notEqual(c[0][1], "rejects");
  });
  test("'what colours do you have?' is a question about availability, not a preference", () => {
    const c = kind("colour", ["courage", "what colours do you have?"]);
    assert.deepEqual(c.map((o) => [o.value, o.stance, o.model]), [["which", "asked", "COURAGE"]]);
  });
});

describe("never from our side of the chat", () => {
  test("a bot or staff line naming cars and colours creates no customer fact", () => {
    const r = read([["automation", "The Courage comes in Pearl Black, Pearl White and Sage Green. The Free 318 too."], ["staff", "Our 917 is in stock"]]);
    assert.equal(r.results.length, 0);
  });
});
