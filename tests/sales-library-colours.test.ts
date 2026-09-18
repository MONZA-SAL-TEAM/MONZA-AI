/**
 * Colours on /sales (Samer, 2026-09-18: "I should be able to remove").
 *
 *  - Removing a colour, or one of its videos, must also remove the small SEND
 *    COPY the bot prefers — otherwise the bot keeps sending a removed video.
 *  - A colour typed into "Add a colour" ("Recon Green") is offered by the bot
 *    once it has a video, and "green" finds it.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { libraryColour, libraryMedia, loadCatalog, type LibraryFile } from "@/lib/wasales/catalog";
import { mediaPrefix, sendCopyPrefix } from "@/lib/wasales/media-paths";
import { runConversation } from "@/lib/wasales/flow";
import { MONZA_KNOWLEDGE } from "@/lib/wasales/knowledge";
import { LIVE_LIBRARY_2026_09_18 } from "@/tests/_live-library";

const SEND = { channel: "whatsapp", autoSendEnabled: true, replyWindowOpen: true, humanLock: false, liveSending: true, attachmentsSupported: true } as const;

function say(files: readonly LibraryFile[], messages: string[]) {
  // What suggestion-server does: the catalogue, plus any colour that exists only in the library.
  const catalog = loadCatalog().map((car) => {
    const extra = [...new Set(files.filter((f) => f.carId === car.id && f.kind === "video" && f.colourId).map((f) => f.colourId as string))].filter(
      (id) => !car.colours.some((c) => c.id === id)
    );
    return { ...car, colours: [...car.colours, ...extra.map((id) => libraryColour(id, id.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")))] };
  });
  const deps = { knowledge: MONZA_KNOWLEDGE, catalog, media: libraryMedia(files), ttlHours: 72 };
  const inputs = messages.map((text, i) => ({ text, brand: "monza", channel: "whatsapp" as const, conversationIsNew: i === 0, now: new Date(Date.parse("2026-09-17T09:00:00.000Z") + i * 60_000).toISOString() }));
  const { turns } = runConversation(inputs, deps, SEND);
  return turns[turns.length - 1].plan.flatMap((p) => (p.kind === "text" ? [p.text, ...p.choices.map((c) => c.title)] : [`[file ${p.name}]`])).join("\n");
}

describe("removing a colour on /sales", () => {
  test("the send copies live beside the originals, and go with them", () => {
    assert.equal(mediaPrefix("voyah-courage", "video", "white"), "voyah-courage/video/white");
    assert.equal(sendCopyPrefix("voyah-courage", "white"), "voyah-courage/video-send/white");
  });

  test("a colour whose original AND copy are gone is no longer offered or sent", () => {
    const without = LIVE_LIBRARY_2026_09_18.filter((f) => !(f.carId === "voyah-courage" && f.colourId === "white"));
    const said = say(without, ["courage colours"]);
    assert.match(said, /Pearl Black/);
    assert.match(said, /Crayon Grey/);
    assert.doesNotMatch(said, /White/);
    assert.match(say(without, ["courage", "white"]), /don't have a video of the VOYAH Courage in Pearl White/i);
  });

  test("THE BUG: the original removed, its send copy left behind — the copy is never sent", () => {
    // Exactly the library on 2026-09-18: Samer removed the old originals, the copies stayed in video-send/.
    const copyLeft = LIVE_LIBRARY_2026_09_18.filter((f) => !(f.carId === "voyah-courage" && f.colourId === "white" && !f.sendCopy));
    const said = say(copyLeft, ["courage", "white"]);
    assert.doesNotMatch(said, /\[file Courage-White/);
    assert.match(said, /don't have a video of the VOYAH Courage in Pearl White/i);
    assert.doesNotMatch(say(copyLeft, ["courage colours"]), /White/);
  });

  test("a copy still stands in for an original that exists", () => {
    assert.match(say(LIVE_LIBRARY_2026_09_18, ["courage", "white"]), /\[file Courage-White\.mp4\]/);
  });

  test("re-filed under the official name: one 'Obsidian Black', never the old 'Black' beside it", () => {
    const refiled: LibraryFile[] = [
      ...LIVE_LIBRARY_2026_09_18.filter((f) => !(f.carId === "mhero-1" && f.kind === "video" && !f.sendCopy)),
      { carId: "mhero-1", kind: "video", colourId: "obsidian-black", name: "mhero-1-obsidian-black.mp4", size: 12_000_000 },
      { carId: "mhero-1", kind: "video", colourId: "storm-grey", name: "mhero-1-storm-grey.mp4", size: 3_000_000 },
    ];
    const said = say(refiled, ["mhero 1 colours"]);
    assert.equal(said.split("Obsidian Black").length - 1, 2, "once in the sentence, once as a button: " + said);
    assert.match(say(refiled, ["mhero 1", "black"]), /\[file mhero-1-obsidian-black\.mp4\]/);
  });
});

describe("a colour added on /sales", () => {
  test("'Recon Green' is found by 'green', in English, French and Arabic", () => {
    const c = libraryColour("recon-green", "Recon Green");
    for (const word of ["recon-green", "recon green", "green", "vert", "اخضر"]) assert.ok(c.aliases.includes(word), word);
    assert.ok(!libraryColour("midnight-blue", "Midnight Blue").aliases.includes("green"));
  });

  test("once it has a video, the bot offers it and sends it", () => {
    const withGreen: LibraryFile[] = [...LIVE_LIBRARY_2026_09_18, { carId: "mhero-1", kind: "video", colourId: "recon-green", name: "mhero-1-recon-green.mp4", size: 4_000_000 }];
    assert.match(say(withGreen, ["mhero 1 colours"]), /Obsidian Black[\s\S]*Storm Grey[\s\S]*Recon Green|Recon Green/);
    assert.match(say(withGreen, ["mhero 1", "green"]), /MHERO 1 in Recon Green[\s\S]*\[file mhero-1-recon-green\.mp4\]/);
    // Today, without that upload, it is said honestly.
    assert.match(say(LIVE_LIBRARY_2026_09_18, ["mhero 1", "green"]), /don't have a video of the MHERO 1 in green/i);
  });
});
