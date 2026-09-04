/**
 * The REAL catalogue — the one lib/wasales/sales-manifest.ts holds after the
 * sales folder has been imported.
 *
 * The other sales tests use fixtures, which is right: they pin down the flow's
 * rules independently of what Monza happens to have filmed. This file does the
 * opposite job. It asserts the invariants that must hold for the data actually
 * shipping, so that a re-import which quietly breaks one of them fails here
 * rather than in a customer's chat.
 *
 * Nothing here hardcodes a model or a colour. The folder is Monza's to change:
 * they will fill Mhero 1's empty Black folder, they will add cars. Every
 * assertion below is written over whatever the manifest contains, so it keeps
 * its meaning after that happens.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  catalogueImported,
  loadCatalog,
  mediaIndexFor,
} from "@/lib/wasales/catalog";
import { sendableColours } from "@/lib/wasales/colours";
import { advance, INITIAL_STATE, type CarMedia } from "@/lib/wasales/flow";

const CATALOG = loadCatalog();

function mediaFor(carId: string): CarMedia {
  const car = CATALOG.find((c) => c.id === carId);
  if (!car) return { hasBrochure: false, videosByColour: {} };
  return { hasBrochure: Boolean(car.brochure), videosByColour: mediaIndexFor(car) };
}

/** What the auto-sender would say to "tell me about the <car>". */
function firstReply(carName: string): string {
  const result = advance(
    {
      text: `hi can i get more information about the ${carName}`,
      isNewNumber: true,
      isFirstMessage: true,
      source: "direct",
      autoSendEnabled: true,
    },
    INITIAL_STATE,
    CATALOG,
    mediaFor
  );
  return result.action.kind === "hold" ? "" : result.action.message;
}

describe("the imported catalogue", () => {
  test("it has been imported at all", () => {
    // If this fails, the manifest was reset and every car below is a seed with
    // no colours — the screen would be honest about it, but so should CI be.
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
});

describe("a colour with no video", () => {
  /**
   * THE RULE THIS FILE EXISTS FOR.
   *
   * An empty colour folder is a real fact about the business: the colour is
   * offered in the showroom, nobody has filmed it yet. It must be VISIBLE —
   * the sales screen shows it greyed out so somebody knows to shoot it — and
   * it must never be OFFERED, because we cannot send what we do not have.
   *
   * Those two requirements pull in opposite directions, and the obvious
   * shortcut (drop empty colours when loading the catalogue) satisfies the
   * second by making the first impossible. So: keep every colour, and let the
   * flow do the filtering. These tests hold that line.
   */
  test("it is still listed on the car, so the gap is visible", () => {
    for (const car of CATALOG) {
      const counts = mediaIndexFor(car);
      for (const colour of car.colours) {
        assert.ok(
          colour.id in counts,
          `${car.name}/${colour.name} is on the car but has no video count`
        );
      }
    }
  });

  test("it is never sendable", () => {
    for (const car of CATALOG) {
      const counts = mediaIndexFor(car);
      for (const colour of sendableColours(car.colours, counts)) {
        assert.ok(
          (counts[colour.id] ?? 0) > 0,
          `${car.name}/${colour.name} is offered with no video`
        );
      }
    }
  });

  test("its name never appears in the message that goes out", () => {
    for (const car of CATALOG) {
      const counts = mediaIndexFor(car);
      const empty = car.colours.filter((c) => (counts[c.id] ?? 0) === 0);
      if (empty.length === 0) continue;

      const said = firstReply(car.name).toLowerCase();
      if (said === "") continue; // held — nothing goes out, nothing to check

      for (const colour of empty) {
        assert.ok(
          !said.includes(colour.name.toLowerCase()),
          `${car.name} offers ${colour.name}, which has no video: "${said}"`
        );
      }
    }
  });
});

describe("what the auto-sender would really do", () => {
  test("a car it answers about has both a brochure and a sendable colour", () => {
    for (const car of CATALOG) {
      if (firstReply(car.name) === "") continue;
      assert.ok(car.brochure, `${car.name} answers with no brochure`);
      assert.ok(
        sendableColours(car.colours, mediaIndexFor(car)).length > 0,
        `${car.name} answers with no sendable colour`
      );
    }
  });

  test("a car missing its material holds, and says which piece is missing", () => {
    for (const car of CATALOG) {
      const sendable = sendableColours(car.colours, mediaIndexFor(car));
      if (car.brochure && sendable.length > 0) continue;

      const result = advance(
        {
          text: `tell me about the ${car.name}`,
          isNewNumber: true,
          isFirstMessage: true,
          source: "direct",
          autoSendEnabled: true,
        },
        INITIAL_STATE,
        CATALOG,
        mediaFor
      );
      assert.equal(result.action.kind, "hold", car.name);
      const reason = result.action.kind === "hold" ? result.action.reason : "";
      assert.match(reason, /brochure|video/, `${car.name}: ${reason}`);
    }
  });

  test("every car in the catalogue is reachable by its own name", () => {
    // A model the matcher cannot find is material nobody can ever be sent.
    // Holding is fine; matching a DIFFERENT car is not.
    for (const car of CATALOG) {
      const result = advance(
        {
          text: `im interested in the ${car.name}`,
          isNewNumber: true,
          isFirstMessage: true,
          source: "direct",
          autoSendEnabled: true,
        },
        INITIAL_STATE,
        CATALOG,
        mediaFor
      );
      if (result.action.kind === "hold") continue;
      assert.equal(result.action.car.id, car.id, `asked for ${car.name}`);
    }
  });
});
