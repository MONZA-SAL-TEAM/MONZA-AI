/**
 * The "is this the right car and colour?" check.
 *
 * The thing being pinned down is a boundary, not a feature: this reads FILE
 * NAMES and never the footage, so every test below is about what a name can
 * and cannot justify. The two failure modes that matter are opposite and both
 * real:
 *
 *   - saying nothing when a name plainly contradicts the folder (a Passion L
 *     video went into Voyah Passion / Black that way, and stayed there)
 *   - crying wolf on names that mean nothing, which is how a warning becomes
 *     something people click past without reading
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { checkColourFit, type ExistingFile } from "@/lib/wasales/colour-check";
import { colourIdFrom, colourNameFrom } from "@/lib/wasales/media-paths";
import type { WaCar } from "@/lib/wasales/matcher";
import type { WaColour } from "@/lib/wasales/colours";

const BLACK: WaColour = { id: "black", name: "Black", aliases: ["black"] };
const GREY: WaColour = { id: "grey", name: "Grey", aliases: ["grey", "gray"] };
const WHITE: WaColour = { id: "white", name: "White", aliases: ["white"] };

function car(id: string, name: string, colours: WaColour[]): WaCar {
  return {
    id,
    name,
    enabled: true,
    aliases: [name.toLowerCase()],
    videos: [],
    colours,
    brochure: null,
    oneLiner: "",
  };
}

const TAISHAN = car("voyah-taishan", "Voyah Taishan", [BLACK, GREY, WHITE]);
const PASSION = car("voyah-passion", "Voyah Passion", [BLACK]);
const PASSION_L = car("voyah-passion-l", "Voyah Passion L", [BLACK, GREY]);
const CATALOG = [TAISHAN, PASSION, PASSION_L];

function check(over: {
  car?: WaCar;
  colourId?: string;
  fileName: string;
  size?: number;
  existing?: ExistingFile[];
}) {
  return checkColourFit({
    car: over.car ?? TAISHAN,
    colourId: over.colourId ?? "black",
    fileName: over.fileName,
    size: over.size ?? 1000,
    existing: over.existing ?? [],
    catalog: CATALOG,
  });
}

const kinds = (ws: ReturnType<typeof check>) => ws.map((w) => w.kind);

describe("a name that contradicts the folder", () => {
  test("a different colour in the name is flagged", () => {
    const ws = check({ fileName: "Courage White.mov", colourId: "black" });
    assert.ok(kinds(ws).includes("other-colour"), JSON.stringify(ws));
    assert.match(ws[0].message, /white/i);
    assert.match(ws[0].message, /Black/);
  });

  test("THE REAL ONE: a Passion L clip filed under Voyah Passion", () => {
    // This exact file sat in the wrong folder in Monza's own material. The
    // name is the only thing that gave it away.
    const ws = check({
      car: PASSION,
      colourId: "black",
      fileName:
        "Crafted-to-stand-apart.-The-all-new-Voyah-Passion-L-in-Black-with-a-Grey-interior.mp4",
    });
    assert.ok(kinds(ws).includes("other-car"), JSON.stringify(ws));
  });

  test("the same exact file filed twice is flagged", () => {
    const ws = check({
      fileName: "clip.mp4",
      size: 4242,
      existing: [
        { carId: "voyah-passion-l", colourId: "grey", name: "clip.mp4", size: 4242 },
      ],
    });
    assert.ok(kinds(ws).includes("duplicate"), JSON.stringify(ws));
    assert.match(ws.find((w) => w.kind === "duplicate")!.message, /Passion L/);
  });

  test("the same NAME at a different size is not a duplicate", () => {
    // Two shoots really do both produce "video.mp4".
    const ws = check({
      fileName: "video.mp4",
      size: 1000,
      existing: [
        { carId: "voyah-passion-l", colourId: "grey", name: "video.mp4", size: 999999 },
      ],
    });
    assert.ok(!kinds(ws).includes("duplicate"), JSON.stringify(ws));
  });

  test("re-uploading into the SAME place is not a duplicate", () => {
    const ws = check({
      fileName: "clip.mp4",
      size: 42,
      existing: [
        { carId: "voyah-taishan", colourId: "black", name: "clip.mp4", size: 42 },
      ],
    });
    assert.ok(!kinds(ws).includes("duplicate"), JSON.stringify(ws));
  });
});

describe("not crying wolf", () => {
  test("a name that agrees with the folder raises nothing", () => {
    const ws = check({ fileName: "Voyah Taishan in Black.mp4", colourId: "black" });
    assert.deepEqual(ws, [], JSON.stringify(ws));
  });

  test("an alias counts as agreement", () => {
    const ws = check({ fileName: "taishan gray walkaround.mp4", colourId: "grey" });
    assert.deepEqual(ws, [], JSON.stringify(ws));
  });

  test("a car whose name CONTAINS another's is not flagged", () => {
    // "Voyah Passion" is inside "Voyah Passion L". Treating that as evidence
    // flagged every single Passion L file the first time this was written.
    for (const [subject, fileName] of [
      [PASSION_L, "The All New Voyah Passion L in Black.mp4"],
      [PASSION_L, "Voyah Passion L Titanium Grey.mp4"],
    ] as const) {
      const ws = checkColourFit({
        car: subject,
        colourId: fileName.toLowerCase().includes("grey") ? "grey" : "black",
        fileName,
        size: 1,
        existing: [],
        catalog: CATALOG,
      });
      assert.ok(!kinds(ws).includes("other-car"), `${fileName}: ${JSON.stringify(ws)}`);
    }
  });

  test("a colour word inside another word is not a match", () => {
    // "Blackpool", "Whitehall" — substring matching would fire on both.
    const ws = check({ fileName: "Whitehall shoot 2026.mp4", colourId: "black" });
    assert.ok(!kinds(ws).includes("other-colour"), JSON.stringify(ws));
  });
});

describe("silence is never mistaken for approval", () => {
  test("a meaningless name says so, rather than saying nothing", () => {
    // Half of Monza's real files look exactly like this.
    const ws = check({ fileName: "copy_C81B4DD7-817D-4B05-883F-B99DC31E6918.mov" });
    assert.deepEqual(kinds(ws), ["no-evidence"]);
    assert.match(ws[0].message, /make sure/i);
  });

  test("no-evidence is not added when there is a real warning to give", () => {
    const ws = check({ fileName: "Courage White.mov", colourId: "black" });
    assert.ok(!kinds(ws).includes("no-evidence"), JSON.stringify(ws));
  });

  test("a colour with no catalogue entry still reads as a name", () => {
    // Adding "Midnight Blue" and uploading before it exists anywhere else.
    const ws = check({ fileName: "taishan midnight blue.mp4", colourId: "midnight-blue" });
    assert.ok(!kinds(ws).includes("other-colour"), JSON.stringify(ws));
  });
});

describe("colour ids and names round-trip", () => {
  test("what a person types becomes a safe path segment", () => {
    assert.equal(colourIdFrom("Midnight Blue"), "midnight-blue");
    assert.equal(colourIdFrom("  PEARL  White "), "pearl-white");
    assert.equal(colourIdFrom("Crayon/Grey"), "crayon-grey");
    assert.equal(colourIdFrom("../../etc"), "etc");
  });

  test("nothing usable gives an empty id, which callers must refuse", () => {
    for (const input of ["", "   ", "///", "...", "!!!"]) {
      assert.equal(colourIdFrom(input), "", JSON.stringify(input));
    }
  });

  test("the id reads back as a name a person would recognise", () => {
    assert.equal(colourNameFrom("midnight-blue"), "Midnight Blue");
    assert.equal(colourNameFrom("black"), "Black");
    assert.equal(colourNameFrom("crayon-grey"), "Crayon Grey");
  });

  test("typed name -> id -> displayed name survives the trip", () => {
    for (const typed of ["Midnight Blue", "Pearl White", "Sage", "Crayon Grey"]) {
      assert.equal(colourNameFrom(colourIdFrom(typed)), typed);
    }
  });
});
