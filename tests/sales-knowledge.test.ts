/**
 * The knowledge the engine may use (lib/wasales/knowledge.ts), the content
 * readiness report, and the conversation state (lib/wasales/context.ts).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  CHANNEL_LIMITS,
  FACT_KEYS,
  MODEL_CODES,
  MONZA_KNOWLEDGE,
  brandSells,
  factStatus,
  mediaFitsChannel,
  modelByCode,
  modelsForBrand,
  readinessReport,
  salesBrandOf,
} from "@/lib/wasales/knowledge";
import { WORKBOOK } from "@/lib/wasales/knowledge-data";
import { folderMedia, libraryMedia, loadCatalog } from "@/lib/wasales/catalog";
import {
  DEFAULT_SALES_CONTEXT_TTL_HOURS,
  freshState,
  isExpired,
  parseState,
  salesContextTtlHours,
} from "@/lib/wasales/context";

const K = MONZA_KNOWLEDGE;
const CATALOG = loadCatalog();

describe("the knowledge that ships", () => {
  test("eight models, each once, each in the catalogue under its own folder", () => {
    assert.deepEqual(K.models.map((m) => m.code), [...MODEL_CODES]);
    for (const m of K.models) {
      assert.ok(CATALOG.some((c) => c.id === m.catalogueId), `${m.code} → ${m.catalogueId}`);
    }
    assert.equal(new Set(K.models.map((m) => m.catalogueId)).size, K.models.length);
    assert.notEqual(modelByCode(K, "PASSION")?.catalogueId, modelByCode(K, "PASSION_L")?.catalogueId);
  });

  test("VOYAH sells six, MHERO two, MONZA SAL all eight", () => {
    assert.equal(modelsForBrand(K, "voyah").length, 6);
    assert.deepEqual(modelsForBrand(K, "mhero").map((m) => m.code), ["MHERO_1", "MHERO_2"]);
    assert.equal(modelsForBrand(K, "monza").length, 8);
    const courage = modelByCode(K, "COURAGE");
    assert.ok(courage && brandSells("voyah", courage) && !brandSells("mhero", courage));
    assert.equal(salesBrandOf("kia"), null);
  });

  test("every fact is the workbook's, approved — nothing invented, and 'not stated' is kept EMPTY", () => {
    for (const m of K.models) {
      const book = WORKBOOK.models[m.code];
      assert.equal(m.displayName, book.officialName, m.code);
      assert.equal(m.bucket, book.bucket, m.code);
      assert.equal(m.seatCount, book.seatCount, m.code);
      const bookFacts = book.facts as Record<string, { value: string; confirmed: boolean }>;
      // Exactly the workbook's facts: none added, none dropped.
      assert.deepEqual(Object.keys(m.facts).sort(), Object.keys(bookFacts).sort(), m.code);
      for (const key of FACT_KEYS) {
        const fact = m.facts[key];
        const source = bookFacts[key];
        if (!source) {
          assert.equal(fact, undefined, `${m.code} / ${key}`);
          continue;
        }
        assert.ok(fact, `${m.code} / ${key}`);
        assert.equal(fact.approved, true, `${m.code} / ${key}`);
        assert.match(fact.source, /workbook/, `${m.code} / ${key}`);
        if (source.confirmed) {
          assert.equal(fact.value, source.value, `${m.code} / ${key}`);
          assert.equal(factStatus(fact), "OK", `${m.code} / ${key}`);
        } else {
          assert.equal(factStatus(fact), "EMPTY", `${m.code} / ${key}`);
        }
      }
    }
    // The official names, and facts the workbook says are not stated.
    assert.equal(modelByCode(K, "COURAGE")?.displayName, "VOYAH Courage");
    assert.equal(modelByCode(K, "FREE_318")?.displayName, "VOYAH Free 318");
    assert.equal(modelByCode(K, "MHERO_1")?.displayName, "MHERO 1");
    // A Car Facts of 2026-09-18, exactly as stored.
    assert.equal(modelByCode(K, "COURAGE")?.facts.HORSEPOWER?.value, "430 HP");
    assert.equal(modelByCode(K, "PASSION_L")?.facts.BATTERY?.value, "65 kWh CATL ternary lithium");
    assert.equal(modelByCode(K, "TAISHAN")?.facts.SEATS?.value, "6 to 7 seats");
    assert.deepEqual(modelByCode(K, "TAISHAN")?.seatOptions, [6, 7], "a 6-seat and a 7-seat question both find it");
    assert.deepEqual(modelByCode(K, "FREE_318")?.colourNames, ["Midnight Black", "British Racing Green", "Titanium Grey", "Sage Green", "Pearl White"]);
    // The one fact still held: A Car Facts says 440 km WLTP, the F sheet says 550 / 440 uphill.
    assert.equal(factStatus(modelByCode(K, "COURAGE")?.facts.RANGE), "EMPTY");
    assert.equal(modelByCode(K, "MHERO_1")?.facts.SEATS?.value, "5", "the workbook writes 5-seat");
  });

  test("the showroom's globals are the workbook's sentences, all approved", () => {
    assert.deepEqual(K.contact, { digits: "70708585", display: "70 70 85 85" });
    assert.equal(factStatus(K.global.CONTACT_NUMBER), "OK");
    assert.equal(factStatus(K.global.LOCATION), "OK");
    assert.equal(factStatus(K.global.OPENING_HOURS), "OK");
    assert.equal(K.global.CONTACT_NUMBER?.value, "For sales enquiries, please contact us on 70 70 85 85.");
    assert.equal(
      K.global.LOCATION?.value,
      "Our showroom is located in Horch Tabet, Beirut.\nhttps://maps.app.goo.gl/CVPJQqXfnnbBmubZ8"
    );
    assert.equal(
      K.global.OPENING_HOURS?.value,
      [
        "Our showroom is open Monday to Friday, from 8:00 AM to 6:00 PM.",
        "Our showroom is open on Saturday, from 8:00 AM to 2:00 PM.",
        "Sunday we are closed and public-holiday availability should be confirmed by a team member.",
      ].join("\n")
    );
    assert.equal(K.showroom.handoff, "Our Sales Team will assist you further right here with all the details you need.");
    assert.deepEqual(K.decisions, { botBooksTestDrives: false, askLeadName: false }, "workbook C, 2026-09-18");
    assert.equal(K.showroom.serviceContact, "For Service, Maintenance, or Spare Parts, please contact 76 877 278.");
  });

  test("it is frozen all the way down", () => {
    assert.ok(Object.isFrozen(K));
    assert.ok(Object.isFrozen(K.models));
    assert.ok(Object.isFrozen(K.models[1].facts.RANGE));
    assert.ok(Object.isFrozen(K.contact));
    assert.ok(Object.isFrozen(CHANNEL_LIMITS.whatsapp));
  });

  test("no ad is mapped to a model yet", () => {
    assert.deepEqual(K.referrals, {});
  });
});

describe("fact status", () => {
  test("five states, kept apart", () => {
    assert.equal(factStatus(undefined), "MISSING");
    assert.equal(factStatus({ value: "470 km", approved: false, source: "" }), "UNAPPROVED");
    assert.equal(factStatus({ value: "  ", approved: true, source: "" }), "EMPTY");
    for (const zero of ["0", "0.0", "0 hp", "0km", "0,0 %"]) {
      assert.equal(factStatus({ value: zero, approved: true, source: "" }), "ZERO", zero);
    }
    for (const real of ["470 km", "0-100 km/h in 4.5 s", "7 seats", "100 kWh"]) {
      assert.equal(factStatus({ value: real, approved: true, source: "" }), "OK", real);
    }
  });
});

describe("what each channel accepts", () => {
  test("size and format", () => {
    const pdf = (bytes: number) => ({ name: "b.pdf", bytes });
    assert.equal(mediaFitsChannel(pdf(24_000_000), "document", "instagram"), null);
    assert.match(mediaFitsChannel(pdf(26_000_000), "document", "facebook") ?? "", /Messenger: 26\.0 MB/);
    assert.equal(mediaFitsChannel(pdf(90_000_000), "document", "whatsapp"), null);
    assert.match(mediaFitsChannel({ name: "v.mp4", bytes: 17_000_000 }, "video", "whatsapp") ?? "", /16\.0 MB/);
    assert.match(mediaFitsChannel({ name: "v.mov", bytes: 1 }, "video", "whatsapp") ?? "", /\.mov/);
    assert.match(mediaFitsChannel({ name: "v.mp4", bytes: null }, "video", "instagram") ?? "", /size unknown/);
  });
});

describe("content readiness (§58), over the real sales folder", () => {
  const report = readinessReport(K, CATALOG, folderMedia);

  test("no alias lands on another car, and no file is filed under two", () => {
    assert.deepEqual(report.problems, []);
  });

  test("every model is reported, with all nine facts", () => {
    assert.equal(report.models.length, 8);
    for (const m of report.models) {
      assert.ok(m.inCatalogue, m.code);
      assert.equal(m.facts.length, FACT_KEYS.length);
    }
  });

  test("the gaps the folder really has are named", () => {
    const byCode = Object.fromEntries(report.models.map((m) => [m.code, m]));
    assert.ok(byCode.PASSION.gaps.some((g) => /No colour has a video/.test(g)));
    assert.ok(byCode.PASSION.brochureBlockedOn.some((b) => /Instagram: 71\.6 MB/.test(b)));
    const white = byCode.COURAGE.colours.find((c) => c.id === "white");
    assert.ok(white?.blockedOn.some((b) => /WhatsApp/.test(b)));
    assert.ok(byCode.MHERO_1.gaps.some((g) => /^Black: no video/.test(g)));
  });

  test("the library view counts only what was uploaded", () => {
    const lookup = libraryMedia([
      { carId: "voyah-courage", kind: "brochure", colourId: null, name: "c.pdf", size: 10 },
      { carId: "voyah-courage", kind: "video", colourId: "black", name: "b.mp4", size: 10 },
      { carId: "voyah-courage", kind: "video", colourId: null, name: "stray.mp4", size: 10 },
    ]);
    assert.deepEqual(lookup("voyah-courage"), {
      brochure: { name: "c.pdf", bytes: 10 },
      videosByColour: { black: [{ name: "b.mp4", bytes: 10 }] },
    });
    assert.deepEqual(lookup("voyah-dream"), { brochure: null, videosByColour: {} });
  });
});

describe("the conversation state", () => {
  test("survives storage exactly", () => {
    const s = {
      ...freshState(),
      activeModel: "COURAGE" as const,
      selectedColour: "black",
      pendingIntents: ["PRICE" as const],
      awaiting: "COLOUR" as const,
      modelActivationId: 3,
      offeredColours: ["black", "grey"],
      updatedAt: "2026-09-14T09:00:00.000Z",
    };
    assert.deepEqual(parseState(JSON.parse(JSON.stringify(s))), s);
  });

  test("anything unreadable falls back, field by field", () => {
    assert.deepEqual(parseState(null), freshState());
    assert.deepEqual(parseState({ version: 2, activeModel: "COURAGE" }), freshState());
    const odd = parseState({
      version: 1,
      activeModel: "KIA_EV9",
      selectedColour: "../../x",
      pendingIntents: ["PRICE", "DROP TABLE", "PRICE"],
      awaiting: "FOREVER",
      modelActivationId: -4,
      offeredModels: ["COURAGE", "TESLA"],
      updatedAt: "yesterday",
    });
    assert.equal(odd.activeModel, null);
    assert.equal(odd.selectedColour, null);
    assert.deepEqual(odd.pendingIntents, ["PRICE"]);
    assert.equal(odd.awaiting, "NONE");
    assert.equal(odd.modelActivationId, 0);
    assert.deepEqual(odd.offeredModels, ["COURAGE"]);
    assert.equal(odd.updatedAt, null);
  });

  test("SALES_CONTEXT_TTL_HOURS: a whole number from 1 to 720, else the default", () => {
    assert.equal(DEFAULT_SALES_CONTEXT_TTL_HOURS, 72);
    assert.equal(salesContextTtlHours("48"), 48);
    assert.equal(salesContextTtlHours(" 24 "), 24);
    for (const bad of [undefined, null, "", "0", "721", "3 days", "-1", "1.5"]) {
      assert.equal(salesContextTtlHours(bad), 72, String(bad));
    }
  });

  test("expiry is strictly after the TTL, and never on a bad timestamp", () => {
    const s = { ...freshState(), updatedAt: "2026-09-14T00:00:00.000Z" };
    assert.equal(isExpired(s, "2026-09-17T00:00:00.000Z", 72), false);
    assert.equal(isExpired(s, "2026-09-17T00:00:01.000Z", 72), true);
    assert.equal(isExpired(s, "not a time", 72), false);
    assert.equal(isExpired(freshState(), "2030-01-01T00:00:00.000Z", 72), false);
  });
});
