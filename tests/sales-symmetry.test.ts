/**
 * SYMMETRY (Samer, 2026-09-18: "every question in the table should be applied
 * to every car so that the system is symmetrical").
 *
 * The wordings below are Samer's own, copied from his workbook: sheet E
 * section 2 (the intent registry) and sheet F column B (the coverage table).
 * Every one of them must work for EVERY car, whether the car is named in the
 * message or was chosen earlier, and the answer must be that car's value in
 * A Car Facts — never another car's, never a guess.
 *
 * For questions that send material (colours, brochure, price, installments,
 * test drive, stock, trade-in, model year, video) the answer must have the
 * same SHAPE for every car. The only difference allowed is what the shared
 * library holds: a car with several colour videos, with one, or with none.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { runConversation } from "@/lib/wasales/flow";
import { MONZA_KNOWLEDGE, type ModelKnowledge } from "@/lib/wasales/knowledge";
import { WORKBOOK } from "@/lib/wasales/knowledge-data";
import { folderMedia, loadCatalog } from "@/lib/wasales/catalog";
import { actionLabel } from "@/lib/wasales/templates";

const DEPS = { knowledge: MONZA_KNOWLEDGE, catalog: loadCatalog(), media: folderMedia, ttlHours: 72 };
const SEND = { channel: "whatsapp", autoSendEnabled: true, replyWindowOpen: true, humanLock: false, liveSending: true, attachmentsSupported: true } as const;
const CARS = MONZA_KNOWLEDGE.models;

function last(messages: string[]) {
  const inputs = messages.map((text, i) => ({
    text,
    brand: "monza",
    channel: "whatsapp" as const,
    conversationIsNew: i === 0,
    now: new Date(Date.parse("2026-09-17T09:00:00.000Z") + i * 60_000).toISOString(),
  }));
  const { turns } = runConversation(inputs, DEPS, SEND);
  return turns[turns.length - 1];
}

const words = (t: ReturnType<typeof last>) =>
  t.plan.flatMap((p) => (p.kind === "text" ? [p.text] : [])).join("\n");

/* ── Sheet E section 2 + sheet F column B: the spec questions ────────────── */

const SPEC_WORDINGS: Record<string, string[]> = {
  HORSEPOWER: ["hp?", "horsepower?", "horse power", "horse power?", "power", "how powerful", "how powerful?", "how many horses", "kW", "قوة السيارة", "قديش قوتها"],
  RANGE: ["range?", "km?", "how many km", "how many km?", "how far", "electric range", "combined range", "full charge", "كم كيلو", "كم كيلو بتمشي", "قديش بتمشي"],
  BATTERY: ["battery?", "battery size", "battery size?", "battery capacity?", "capacity", "kWh", "what battery", "بطارية", "سعة البطارية", "قديش البطارية"],
  POWERTRAIN: ["electric or hybrid?"],
  CHARGING: ["charging?", "charging time?", "charge time", "fast charge", "DC", "AC", "AC / DC?", "20–80", "30–80", "how long to charge", "شحن", "قديش بدو شحن"],
  SEATS: ["seats?", "how many seats", "how many seats?", "how many people", "كم راكب"],
  DIMENSIONS: ["size?", "dimensions", "dimensions?", "length", "width", "height", "trunk", "trunk size?", "boot", "luggage", "cargo", "حجم", "صندوق"],
  WARRANTY: ["warranty?", "في كفالة؟"],
};

describe("sheet F: every spec question, every car, the workbook's own value", () => {
  test("A Car Facts states every one of the eight facts for every one of the eight cars", () => {
    for (const car of CARS) {
      for (const fact of Object.keys(SPEC_WORDINGS)) {
        const cell = (WORKBOOK.models[car.code].facts as Record<string, { value: string; confirmed: boolean }>)[fact];
        assert.ok(cell?.confirmed && cell.value !== "", `${car.displayName} / ${fact}`);
      }
    }
  });

  for (const [fact, wordings] of Object.entries(SPEC_WORDINGS)) {
    test(`${fact}: ${wordings.length} wordings × ${CARS.length} cars × named / chosen earlier`, () => {
      for (const car of CARS) {
        // "(trunk capacity not confirmed yet)" is the importer's wording for the workbook's "trunk not stated".
        const value = (WORKBOOK.models[car.code].facts as Record<string, { value: string }>)[fact].value.split(" (")[0];
        for (const w of wordings) {
          assert.ok(words(last([`${car.displayName} ${w}`])).includes(value), `named: "${car.displayName} ${w}" must say "${value}"`);
          assert.ok(words(last([car.displayName, w])).includes(value), `chosen earlier: "${car.displayName}" then "${w}" must say "${value}"`);
        }
      }
    });
  }

  test("an answer never carries another car's figure", () => {
    for (const car of CARS) {
      const said = words(last([`${car.displayName} hp?`]));
      for (const other of CARS) {
        if (other.code === car.code) continue;
        const theirs = WORKBOOK.models[other.code].facts.HORSEPOWER.value;
        if (theirs !== WORKBOOK.models[car.code].facts.HORSEPOWER.value) assert.ok(!said.includes(theirs), `${car.displayName} hp? said ${other.displayName}'s ${theirs}`);
      }
    }
  });
});

/* ── The questions that send material: one shape for every car ───────────── */

const MATERIAL_WORDINGS: Record<string, string[]> = {
  COLOURS: ["which colours?", "show all colors"],
  VIDEO_PHOTOS: ["video?", "video", "pictures", "photos", "show me the car"],
  BROCHURE: ["brochure?", "catalogue?", "full specs please"],
  PRICE: ["price", "how much", "pricing", "سعر", "شو السعر", "se3er"],
  INSTALLMENTS_FINANCE: ["installments", "financing", "payment plan", "down payment", "first payment", "0%", "interest", "تقسيط", "دفعة"],
  TEST_DRIVE: ["test drive", "drive it", "book test drive", "تجربة قيادة"],
  STOCK: ["in stock", "available now", "available?", "mawjoude?", "موجودة؟"],
  TRADE_IN: ["trade in", "exchange my car", "take my old car", "بدل", "بتاخدو سيارتي"],
  MODEL_YEAR: ["what year", "model year"],
};

/** What the shared library holds for a car: the one thing allowed to change the shape of an answer. */
function mediaProfile(car: ModelKnowledge): "several colour videos" | "one video" | "no video" {
  const have = folderMedia(car.catalogueId);
  const colours = Object.values(have.videosByColour).filter((files) => files.some((f) => f.view !== "interior")).length;
  return colours === 0 ? "no video" : colours === 1 ? "one video" : "several colour videos";
}

function shape(car: ModelKnowledge, wording: string): string {
  const name = car.code.replace(/_/g, " ");
  return last([`${car.displayName} ${wording}`])
    .decision.actions.map(actionLabel)
    .map((l) => l.split(name).join("X").replace(/X [A-Z ]+ VIDEO/, "X VIDEO"))
    .join(" | ");
}

describe("sheet E: every sales and material question has the same shape for every car", () => {
  for (const [intent, wordings] of Object.entries(MATERIAL_WORDINGS)) {
    test(`${intent}: ${wordings.length} wordings × ${CARS.length} cars`, () => {
      for (const w of wordings) {
        const byProfile = new Map<string, Map<string, string[]>>();
        for (const car of CARS) {
          const s = shape(car, w);
          assert.notEqual(s, "", `"${car.displayName} ${w}" got no answer`);
          assert.ok(s.startsWith("SEND X BROCHURE"), `"${car.displayName} ${w}": the brochure comes first — ${s}`);
          const shapes = byProfile.get(mediaProfile(car)) ?? new Map<string, string[]>();
          shapes.set(s, [...(shapes.get(s) ?? []), car.displayName]);
          byProfile.set(mediaProfile(car), shapes);
        }
        for (const [profile, shapes] of byProfile) {
          assert.equal(
            shapes.size,
            1,
            `"${w}" is answered differently among cars with ${profile}:\n${[...shapes].map(([s, cars]) => `  ${cars.join(", ")} → ${s}`).join("\n")}`
          );
        }
      }
    });
  }

  test("the commercial questions hand off and alert Sales for every car, whatever the library holds", () => {
    for (const [wording, key, kind] of [
      ["price", "PRICE HANDOFF", "PRICE"],
      ["installments", "SALES FOLLOWUP", "FINANCING"],
      ["test drive", "TEST DRIVE REQUEST", "TEST DRIVE"],
      ["in stock", "STOCK CONFIRM", "STOCK"],
    ] as const) {
      for (const car of CARS) {
        const s = shape(car, wording);
        assert.ok(s.includes(`SAY ${key}`), `${car.displayName} ${wording}: ${s}`);
        assert.ok(s.includes(`ALERT SALES — ${kind}`), `${car.displayName} ${wording}: ${s}`);
      }
    }
  });
});
