/**
 * The insights READER (lib/wasales/reader.ts) and its colour/model observer (observe.ts): a conversation
 * read the way a person reads it, and what a customer wants — car and colour — kept as facts, never words.
 *
 * Samer, 2026-10-12: "I want to know all data of clients and leads … what they most like: colour, car
 * model and more." Phrasing is real Lebanese customer language: English, Arabizi, Arabic.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listenerState, readConversation, READER_VERSION, type Turn } from "@/lib/wasales/reader";
import type { Observation } from "@/lib/wasales/observe";
import { freshState } from "@/lib/wasales/context";
import { MONZA_KNOWLEDGE } from "@/lib/wasales/knowledge";
import { loadCatalog } from "@/lib/wasales/catalog";
import { liveMedia } from "@/tests/_live-library";

const DEPS = { knowledge: MONZA_KNOWLEDGE, catalog: loadCatalog(), media: liveMedia, ttlHours: 72 };
const META = { accountId: "wa-monza", brand: "monza", channel: "whatsapp", conversationId: "c1" };
const T0 = Date.parse("2026-10-12T09:00:00.000Z");

type Line = string | [Turn["author"], string] | { text: string; minutes: number };
function read(lines: Line[]) {
  let minute = 0;
  const turns: Turn[] = lines.map((l, i) => {
    const [author, text] = typeof l === "string" ? ["customer" as const, l] : Array.isArray(l) ? l : ["customer" as const, l.text];
    minute = typeof l === "object" && !Array.isArray(l) ? minute + l.minutes : minute + 1;
    return { author, text, hasMedia: false, at: new Date(T0 + minute * 60_000).toISOString(), externalMessageId: `m${i}` };
  });
  return readConversation(turns, META, DEPS);
}
const facts = (lines: Line[]) => read(lines).results.flatMap((r) => r.observations);
const colours = (lines: Line[]) => facts(lines).filter((o) => o.kind === "colour");
const pick = (o: Observation) => ({ value: o.value, stance: o.stance, model: o.model, part: o.part });

describe("a conversation is read with memory", () => {
  test("'do you have it in white?' after the Free 318 is white, asked, for the Free 318", () => {
    const r = read(["Free 318 price?", "do you have it in white?"]);
    const white = r.results[1].observations.find((o) => o.kind === "colour")!;
    assert.deepEqual(pick(white), { value: "white", stance: "asked", model: "FREE_318", part: "exterior" });
    assert.equal(white.binding, "conversation");
    assert.equal(white.detail, "Pearl White");
    assert.deepEqual(r.results[1].signal.contextModels, ["FREE_318"]);
  });

  test("a 'yes' after a silent bot is not read as the answer to a question nobody asked", () => {
    const r = read(["courage", "yes"]);
    assert.deepEqual(r.results[1].observations, []);
    assert.equal(listenerState({ ...freshState(), awaiting: "COLOUR", offeredModels: ["DREAM"] }).awaiting, "NONE");
    assert.deepEqual(listenerState({ ...freshState(), offeredModels: ["DREAM"] }).offeredModels, []);
  });

  test("the memory ends after 72 hours: a colour three days later is tied to no car", () => {
    const later = colours(["courage", { text: "do you have it in black?", minutes: 73 * 60 }]);
    assert.equal(later.length, 1);
    assert.equal(later[0].model, null);
  });

  test("a car the staff named is context, never the customer's interest", () => {
    const r = read([["staff", "Here is the VOYAH Courage brochure"], "w bel aswad?"]);
    assert.equal(r.results.length, 1, "the staff line is not a customer message");
    assert.equal(r.results[0].observations.filter((o) => o.kind === "model").length, 0);
    assert.deepEqual(pick(r.results[0].observations[0]), { value: "black", stance: "asked", model: "COURAGE", part: "exterior" });
  });

  test("the reader version is recorded, so old readings can be found and read again", () => {
    assert.equal(read(["courage"]).results[0].signal.readerVersion, READER_VERSION);
  });
});

describe("colour: what they want, ask about, and refuse — exterior and interior", () => {
  test("a wish", () => {
    assert.deepEqual(colours(["bade el courage aswad"]).map(pick), [{ value: "black", stance: "wants", model: "COURAGE", part: "exterior" }]);
    assert.deepEqual(colours(["courage", "black"]).map((o) => o.stance), ["wants"]);
  });

  test("a refusal is never counted as a wish", () => {
    assert.deepEqual(colours(["courage", "ma bade aswad, fi abyad?"]).map((o) => [o.value, o.stance]), [["black", "rejects"], ["white", "asked"]]);
    assert.deepEqual(colours(["courage", "I don't want black"]).map((o) => o.stance), ["rejects"]);
    assert.deepEqual(colours(["taishan", "kel shi ella el abyad"]).map((o) => [o.value, o.stance]), [["white", "rejects"]]);
    assert.deepEqual(colours(["taishan", "أي لون غير الأبيض"]).map((o) => [o.value, o.stance]), [["white", "rejects"]]);
  });

  test("interior colours", () => {
    assert.deepEqual(colours(["dream", "fersh beige"]).map(pick), [{ value: "beige", stance: "asked", model: "DREAM", part: "interior" }]);
    assert.deepEqual(colours(["dream", "من جوا بيج"]).map((o) => o.part), ["interior"]);
    assert.deepEqual(colours(["passion l", "grey inside, white outside"]).map((o) => [o.value, o.part]), [["grey", "interior"], ["white", "exterior"]]);
  });

  test("each colour is tied to its own car", () => {
    const c = colours(["taishan blue w dream black"]);
    assert.deepEqual(c.map((o) => [o.value, o.model, o.binding]), [["blue", "TAISHAN", "same_clause"], ["black", "DREAM", "same_clause"]]);
    assert.equal(c[0].detail, "Sapphire Blue");
  });

  test("the workbook's own colour name is found from a word only it has", () => {
    assert.deepEqual(colours(["free 318", "sage please"]).map((o) => [o.value, o.detail]), [["green", "Sage Green"]]);
  });

  test("'any colour is fine' is no preference — not a colour", () => {
    assert.deepEqual(colours(["courage", "any colour is fine"]).map((o) => [o.value, o.stance]), [["any", "no_preference"]]);
  });
});

describe("cars: named, compared, wanted, refused", () => {
  const models = (lines: Line[]) => facts(lines).filter((o) => o.kind === "model").map((o) => [o.model, o.stance]);
  test("named and compared", () => {
    assert.deepEqual(models(["courage"]), [["COURAGE", "named"]]);
    assert.deepEqual(models(["courage vs free 318"]).sort(), [["COURAGE", "compared"], ["FREE_318", "compared"]].sort());
  });
  test("refused", () => {
    assert.deepEqual(models(["not the dream, the taishan"]), [["DREAM", "rejects"], ["TAISHAN", "named"]]);
  });
  test("wanted", () => {
    assert.deepEqual(models(["bade el courage"]), [["COURAGE", "wants"]]);
  });
  test("an ordinary word is never a car: 'my dream car' names nothing", () => {
    assert.deepEqual(models(["this is my dream car"]), []);
  });
});

describe("never the words", () => {
  test("every value is a closed-vocabulary key, and no customer word reaches the output", () => {
    const lines = ["bade el courage aswad", "ma bade abyad, fi rmadi?", "fersh beige please", "kel shi ella el ahmar", "my budget is around 40k"];
    const r = read(lines);
    for (const o of r.results.flatMap((x) => x.observations)) {
      assert.match(o.value, /^[a-z0-9_]{1,40}$/);
      assert.match(o.rule, /^[a-z0-9_.]{1,60}$/);
      if (o.detail) assert.match(o.detail, /^[A-Za-z0-9 ]{1,40}$/);
    }
    const json = JSON.stringify(r.results).toLowerCase();
    for (const w of ["bade", "please", "around", "kel shi"]) assert.ok(!json.includes(w), `"${w}" leaked`);
  });

  test("the database refuses free text: the value check is in the migration", () => {
    const sql = readFileSync(join(process.cwd(), "database/migrations/021_insight_reader.sql"), "utf8");
    assert.match(sql, /value\s+text not null check \(value ~ '\^\[a-z0-9_\]\{1,40\}\$'\)/);
    assert.equal((sql.match(/enable row level security/g) ?? []).length, 4);
    assert.doesNotMatch(sql, /create policy/i);
  });
});
