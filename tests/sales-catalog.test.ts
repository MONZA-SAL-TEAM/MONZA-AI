/**
 * The REAL catalogue and knowledge — lib/wasales/sales-manifest.ts after the
 * sales folder was imported, and MONZA_KNOWLEDGE as it ships.
 *
 * The engine tests use fixtures, which is right: they pin down the rules
 * independently of what Monza happens to have filmed or approved. This file
 * does the opposite job. It asserts the invariants that must hold for the
 * data actually shipping, so that a re-import which quietly breaks one of
 * them fails here rather than in a customer's chat.
 *
 * Nothing here hardcodes a colour. Every assertion is written over whatever
 * the manifest contains, so it keeps its meaning when Monza fills an empty
 * colour folder or adds a car. The exceptions are the words customers use
 * for each model (Samer's list) and the definition of done, run over the
 * real knowledge from Samer's workbook.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SUPERSEDED_BY_LIVE_CHECK,
  catalogueImported,
  folderMedia,
  folderWarnings,
  loadCatalog,
  mediaIndexFor,
} from "@/lib/wasales/catalog";
import { sendableColours } from "@/lib/wasales/colours";
import { decide, type EngineDecision } from "@/lib/wasales/engine";
import { freshState, type SearchEngineState } from "@/lib/wasales/context";
import { MONZA_KNOWLEDGE, videoCounts } from "@/lib/wasales/knowledge";
import { actionLabel, renderPlan } from "@/lib/wasales/templates";
import { isCustomerFacing } from "@/lib/wasales/actions";
import { matchModel } from "@/lib/wasales/matcher";
import { WORKBOOK } from "@/lib/wasales/knowledge-data";

const CATALOG = loadCatalog();
const K = MONZA_KNOWLEDGE;

function say(text: string, brand = "monza", state: SearchEngineState = freshState()): EngineDecision {
  return decide(
    { text, brand, conversationIsNew: state.updatedAt === null, now: "2026-09-14T09:00:00.000Z" },
    state,
    { knowledge: K, catalog: CATALOG, media: folderMedia, ttlHours: 72 }
  );
}

function words(d: EngineDecision, brand = "monza"): string {
  return renderPlan(d.actions, { channel: "instagram", brand: brand as "monza", knowledge: K })
    .map((p) => (p.kind === "text" ? p.text : ""))
    .join(" ");
}

describe("the imported catalogue", () => {
  test("it has been imported at all", () => {
    assert.ok(catalogueImported(), "run scripts/import-sales-folder.mjs");
    assert.ok(CATALOG.length > 0);
  });

  test("every car has a distinct id and a name a person would recognise", () => {
    const ids = new Set<string>();
    for (const car of CATALOG) {
      assert.ok(!ids.has(car.id), `duplicate car id ${car.id}`);
      ids.add(car.id);
      assert.match(car.id, /^[a-z0-9-]+$/, car.id);
      assert.ok(car.name.trim().length > 2, car.name);
    }
  });

  test("every colour has a distinct id within its car", () => {
    for (const car of CATALOG) {
      const ids = new Set<string>();
      for (const colour of car.colours) {
        assert.ok(!ids.has(colour.id), `${car.name}: duplicate colour ${colour.id}`);
        ids.add(colour.id);
        assert.match(colour.id, /^[a-z0-9-]+$/, `${car.name}/${colour.id}`);
      }
    }
  });

  test("every knowledge model has its own catalogue car", () => {
    for (const m of K.models) {
      assert.ok(CATALOG.some((c) => c.id === m.catalogueId), m.code);
    }
  });
});

describe("the words customers use (Samer, 2026-09-12)", () => {
  const WORDS: [string, string][] = [
    ["free", "voyah-free-comp"],
    ["free 318", "voyah-free-comp"],
    ["courage", "voyah-courage"],
    ["كوراج", "voyah-courage"],
    ["dream", "voyah-dream"],
    ["passion", "voyah-passion"],
    ["passion l", "voyah-passion-l"],
    ["taishan", "voyah-taishan"],
    ["تايشان", "voyah-taishan"],
    ["mhero 1", "mhero-1"],
    ["mhero1", "mhero-1"],
    ["917", "mhero-1"],
    ["mhero 2", "mhero-2"],
    ["817", "mhero-2"],
  ];

  test("each one reaches its own car", () => {
    for (const [word, id] of WORDS) {
      assert.equal(matchModel(`hi, ${word}?`, CATALOG).model?.id, id, word);
    }
  });

  test("'mhero' alone is a question on MHERO and MONZA SAL — and another brand on VOYAH", () => {
    assert.match(actionLabel(say("info about the mhero", "mhero").actions[0]), /^SHOW MODEL CHOICES/);
    assert.match(actionLabel(say("info about the mhero", "monza").actions[0]), /^SHOW MODEL CHOICES/);
    const onVoyah = say("info about the mhero", "voyah");
    assert.deepEqual(onVoyah.understanding.crossBrand, ["MHERO_1", "MHERO_2"]);
  });

  test("a bare 'i' never picks the Mhero 1, and 'feel free' is not the Free", () => {
    assert.notEqual(matchModel("the mhero i saw on instagram", CATALOG).model?.id, "mhero-1");
    assert.equal(matchModel("feel free to call me back", CATALOG).decision, "hold");
  });
});

describe("a colour with no video", () => {
  test("it is still listed on the car, so the gap is visible", () => {
    for (const car of CATALOG) {
      const counts = mediaIndexFor(car);
      for (const colour of car.colours) {
        assert.ok(colour.id in counts, `${car.name}/${colour.name} has no video count`);
      }
    }
  });

  test("it is never offered, and its name never appears in anything said", () => {
    for (const m of K.models) {
      const car = CATALOG.find((c) => c.id === m.catalogueId);
      if (!car) continue;
      const counts = videoCounts(folderMedia(car.id));
      const empty = car.colours.filter((c) => (counts[c.id] ?? 0) === 0);
      if (empty.length === 0) continue;
      const d = say(`im interested in the ${car.name}`);
      const said = words(d).toLowerCase();
      for (const colour of empty) {
        assert.ok(!said.includes(colour.name.toLowerCase()), `${car.name} names ${colour.name}: "${said}"`);
      }
      for (const a of d.actions) {
        if (a.type === "SHOW_COLOUR_CHOICES") {
          const offerable = sendableColours(car.colours, counts).map((c) => c.id);
          for (const c of a.colours) assert.ok(offerable.includes(c.id), `${car.name}/${c.id}`);
        }
      }
    }
  });
});

describe("what the engine would really do", () => {
  test("every model is reachable by its own name, and opens with its own brochure", () => {
    for (const m of K.models) {
      const car = CATALOG.find((c) => c.id === m.catalogueId);
      if (!car) continue;
      const d = say(`im interested in the ${car.name}`);
      assert.equal(d.understanding.model, m.code, car.name);
      const first = d.actions.filter(isCustomerFacing)[0];
      assert.ok(
        (first?.type === "SEND_BROCHURE" && first.model === m.code) ||
          d.gaps.some((g) => g.content === "BROCHURE"),
        car.name
      );
    }
  });

  test("the definition of done over the REAL knowledge: every VOYAH's power, then the Courage", () => {
    const hp = say("hp?", "voyah");
    assert.deepEqual(hp.actions.map(actionLabel), [
      "SEND FREE 318 + COURAGE + DREAM + PASSION + PASSION L + TAISHAN HORSEPOWER (ALL MODELS)",
      "SHOW MODEL CHOICES (FREE 318, COURAGE, DREAM, PASSION, PASSION L, TAISHAN)",
    ]);
    assert.deepEqual(hp.gaps, [], "the workbook states every VOYAH's power");
    assert.match(
      words(hp, "voyah"),
      /^Here is the power output for our current models:\n• VOYAH Free 318 — 600 hp\n• VOYAH Courage — 430 HP\n/
    );
    assert.match(words(hp, "voyah"), /Which model would you like to explore further\?$/);

    const courage = decide(
      { text: "courage", brand: "voyah", conversationIsNew: false, now: "2026-09-14T09:01:00.000Z" },
      hp.nextState,
      { knowledge: K, catalog: CATALOG, media: folderMedia, ttlHours: 72 }
    );
    assert.deepEqual(courage.actions.map(actionLabel), ["SEND COURAGE BROCHURE", "SHOW COURAGE COLOURS"]);
  });

  test("a fact is sent exactly as the workbook states it — and 'not stated' says so", () => {
    const hp = say("courage hp?", "voyah");
    assert.deepEqual(hp.gaps, []);
    const rows = hp.actions.flatMap((a) => (a.type === "SEND_FACTS" ? a.rows : []));
    assert.deepEqual(rows, [{ model: "COURAGE", fact: "HORSEPOWER", value: "430 HP", confirmed: true }]);
    assert.match(words(hp, "voyah"), /The VOYAH Courage produces 430 HP\./);

    // HELD (docs/SALES-FACTS-DISCREPANCIES.md): A Car Facts says 440 km WLTP, the same workbook's
    // F sheet says "550 km … if up hill 440 km", Monza's video says 470 km. The bot never picks one.
    const range = say("courage range?", "voyah");
    assert.deepEqual(range.gaps, []);
    assert.match(words(range, "voyah"), /The exact range of the VOYAH Courage is not confirmed yet\./);
    for (const figure of ["440", "470", "550"]) assert.ok(!words(range, "voyah").includes(figure), figure);

    assert.match(words(range, "voyah"), /Our Sales Team can confirm it with you right here\./);
    assert.ok(!range.actions.some((a) => a.type === "SEND_CONTACT_FALLBACK"));
    assert.ok(range.actions.some((a) => a.type === "ALERT_SALES" && a.kind === "QUESTION"), "the promise of a person reaches a person");

    // Stated since the 2026-09-18 workbook (it was "not currently stated" before).
    const battery = say("passion l battery?", "voyah");
    assert.deepEqual(battery.gaps, []);
    assert.match(words(battery, "voyah"), /The VOYAH Passion L battery: 65 kWh CATL ternary lithium\./);
  });

  test("every fact in every answer comes from the workbook, over every model and fact question", () => {
    for (const m of K.models) {
      const car = CATALOG.find((c) => c.id === m.catalogueId);
      if (!car) continue;
      for (const q of ["hp", "range", "battery", "charging", "seats", "dimensions", "warranty"]) {
        const d = say(`${car.name} ${q}?`, m.brand);
        for (const a of d.actions) {
          if (a.type !== "SEND_FACTS") continue;
          for (const row of a.rows) {
            const book = (WORKBOOK.models[row.model].facts as Record<string, { value: string; confirmed: boolean }>)[row.fact];
            assert.ok(book, `${car.name} ${q}: ${row.fact}`);
            assert.equal(row.confirmed, book.confirmed, `${car.name} ${q}`);
            assert.equal(row.value, book.confirmed ? book.value : "", `${car.name} ${q}`);
          }
        }
      }
    }
  });
});

describe("import warnings versus the live check", () => {
  // The exact sentence endings scripts/import-sales-folder.mjs writes for the
  // gaps the Sales screen now checks live. If the importer's wording changes,
  // these fail rather than the stale warnings quietly coming back.
  const LIVE_CHECKED = [
    ": folder is empty — cannot be offered.",
    ": no catalogue PDF — it can never auto-send.",
    ": videos are not in colour folders — treated as one option with no colour choice.",
  ];

  test("each pattern matches what the importer actually writes", () => {
    const importer = readFileSync(join(process.cwd(), "scripts", "import-sales-folder.mjs"), "utf8");
    for (const ending of LIVE_CHECKED) {
      assert.ok(importer.includes(ending), `importer no longer writes "${ending}"`);
      assert.ok(SUPERSEDED_BY_LIVE_CHECK.some((p) => p.test(`Some Car / Black${ending}`)), ending);
    }
  });

  test("gaps the library can answer never reach the screen as folder warnings", () => {
    for (const w of folderWarnings()) {
      for (const ending of LIVE_CHECKED) assert.ok(!w.endsWith(ending), w);
    }
  });

  test("a warning the library cannot answer is kept", () => {
    const oversize = "Voyah Dream / big.mov: 250.0 MB is over the 200 MB limit — compress before uploading.";
    assert.ok(!SUPERSEDED_BY_LIVE_CHECK.some((p) => p.test(oversize)));
  });
});
