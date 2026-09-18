/**
 * Sales suggestions in the inbox (lib/wasales/suggest.ts): which messages a
 * suggestion answers, when it stops because a person replied, and what it
 * remembers — with a person always pressing Send (Samer, 2026-09-15).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  afterSend,
  freshSaved,
  isOurs,
  suggestForThread,
  SUGGESTION_AUTOMATION_PREFIX,
  type SavedSuggestion,
  type ThreadFacts,
} from "@/lib/wasales/suggest";
import { savedFromRow } from "@/lib/wasales/suggestion-store";
import { libraryMedia, type LibraryFile } from "@/lib/wasales/catalog";
import { MONZA_KNOWLEDGE } from "@/lib/wasales/knowledge";
import { actionLabel, planLines } from "@/lib/wasales/templates";
import { NO_TEXT } from "@/lib/channels/live-map";
import type { EngineDeps } from "@/lib/wasales/engine";
import type { InboxMessage } from "@/lib/inbox/types";
import type { WaCar } from "@/lib/wasales/matcher";

function car(id: string, name: string, aliases: string[], colours: string[]): WaCar {
  return {
    id,
    name,
    enabled: true,
    aliases,
    videos: [],
    colours: colours.map((c) => ({ id: c, name: c.charAt(0).toUpperCase() + c.slice(1), aliases: [c] })),
    brochure: null,
    oneLiner: "",
  };
}

const CATALOG: WaCar[] = [
  car("voyah-free-comp", "Voyah Free Comp", ["free"], ["black", "white"]),
  car("voyah-courage", "Voyah Courage", ["courage"], ["black", "grey", "white"]),
  car("voyah-dream", "Voyah Dream", ["dream"], ["standard"]),
  car("voyah-passion", "Voyah Passion", ["passion"], ["black"]),
  car("voyah-passion-l", "Voyah Passion L", ["passion l"], ["black", "grey"]),
  car("voyah-taishan", "Voyah Taishan", ["taishan"], ["black", "grey"]),
  car("mhero-1", "Mhero 1", ["mhero 1"], ["grey"]),
  car("mhero-2", "Mhero 2", ["mhero 2"], ["black", "white"]),
];

const URL = "https://example.supabase.co/storage/v1/object/public/wasales-media";

function files(brochureBytes = 2_000_000): LibraryFile[] {
  const out: LibraryFile[] = [];
  for (const c of CATALOG) {
    out.push({ carId: c.id, kind: "brochure", colourId: null, name: `${c.id}.pdf`, size: brochureBytes, url: `${URL}/${c.id}/b.pdf` });
    for (const col of c.colours) {
      out.push({ carId: c.id, kind: "video", colourId: col.id, name: `${c.id}-${col.id}.mp4`, size: 5_000_000, url: `${URL}/${c.id}/${col.id}.mp4` });
    }
  }
  return out;
}

function deps(brochureBytes?: number): EngineDeps {
  return { knowledge: MONZA_KNOWLEDGE, catalog: CATALOG, media: libraryMedia(files(brochureBytes)), ttlHours: 72 };
}

const T0 = Date.parse("2026-09-15T09:00:00.000Z");

function msg(id: string, direction: "in" | "out", text: string, minutes: number, extra: Partial<InboxMessage> = {}): InboxMessage {
  return {
    id,
    conversationId: "ig-voyah~t1",
    direction,
    author: direction === "in" ? "customer" : "staff",
    text,
    at: new Date(T0 + minutes * 60_000).toISOString(),
    status: direction === "in" ? "received" : "sent",
    ...extra,
  };
}

function facts(messages: InboxMessage[], over: Partial<ThreadFacts> = {}): ThreadFacts {
  return { brand: "voyah", channel: "instagram", messages, windowOpen: true, ...over };
}

function suggest(messages: InboxMessage[], saved: SavedSuggestion = freshSaved(), over: Partial<ThreadFacts> = {}, d = deps()) {
  return suggestForThread(facts(messages, over), saved, d, { liveSending: true });
}

function labels(s: ReturnType<typeof suggest>): string[] {
  assert.equal(s.kind, "suggestion", s.kind === "suggestion" ? "" : s.reason);
  return s.kind === "suggestion" ? s.turn.decision.actions.map(actionLabel) : [];
}

describe("what a suggestion answers", () => {
  test("a new chat's hello: the welcome and the departments", () => {
    const s = suggest([msg("c1", "in", "hi", 0)]);
    assert.deepEqual(labels(s), ["SHOW DEPARTMENTS"]);
    if (s.kind === "suggestion") {
      // (The missing full stop after the brand is asserted, as a BUG, in sales-templates.test.ts.)
      assert.match(planLines(s.turn.plan)[0], /^Hello and welcome to VOYAH Lebanon/);
      const first = s.turn.plan[0];
      assert.ok(first.kind === "text");
      if (first.kind === "text") {
        assert.deepEqual(first.choices.map((c) => c.title), ["Sales", "Customer Service", "After-Sales", "Service & Maintenance", "Administration"]);
        assert.deepEqual(first.choices.map((c) => c.payload), ["DEPT:SALES", "DEPT:CUSTOMER_SERVICE", "DEPT:AFTER_SALES", "DEPT:SERVICE", "DEPT:ADMIN"]);
      }
      assert.deepEqual(s.answered, ["c1"]);
      assert.equal(s.turn.policy.wouldSend, true);
    }
  });

  test("every customer message since our last reply is read as one", () => {
    const s = suggest([msg("c1", "in", "hi", 0), msg("c2", "in", "courage", 1), msg("c3", "in", "price?", 2)]);
    assert.deepEqual(labels(s), [
      // Workbook C (2026-09-18): brochure + model video, then Sales in the same chat.
      "SEND COURAGE BROCHURE",
      "SEND COURAGE PEARL BLACK VIDEO",
      "SAY PRICE HANDOFF (COURAGE)",
      "ALERT SALES — PRICE (COURAGE)",
    ]);
  });

  test("only what came after our last reply", () => {
    const saved = { ...freshSaved(), sentMessageIds: ["o1"] };
    const s = suggest([msg("c1", "in", "hi", 0), msg("o1", "out", "Hello and welcome…", 1), msg("c2", "in", "courage", 2)], saved);
    if (s.kind === "suggestion") assert.deepEqual(s.answered, ["c2"]);
    assert.equal(labels(s)[0], "SEND COURAGE BROCHURE");
  });

  test("nothing to answer when our reply is the latest", () => {
    const saved = { ...freshSaved(), sentMessageIds: ["o1"] };
    assert.equal(suggest([msg("c1", "in", "hi", 0), msg("o1", "out", "Hello", 1)], saved).kind, "nothing_to_answer");
    assert.equal(suggest([]).kind, "nothing_to_answer");
  });

  test("a question from weeks ago is not part of today's", () => {
    const s = suggest([msg("c1", "in", "price?", -60 * 24 * 10), msg("c2", "in", "hi", 0)]);
    if (s.kind === "suggestion") assert.deepEqual(s.answered, ["c2"]);
    assert.equal(s.kind === "suggestion" && s.turn.decision.nextState.pendingIntents.length, 0);
  });

  test("the inbox's own 'open the app to see it' is never read as the customer's words", () => {
    const s = suggest([msg("c1", "in", NO_TEXT, 0, { attachments: [{ kind: "image", state: "unavailable" }] })]);
    // The placeholder is not read as words: it is a photo — acknowledged, handed to a person, and nothing guessed from it.
    assert.deepEqual(labels(s), ["SAY PHOTO RECEIVED", "ALERT SALES — NEEDS PERSON"]);
    assert.equal(s.kind === "suggestion" && s.turn.decision.understanding.reading.tokens.length, 0);
  });

  test("the brand is the account's", () => {
    const s = suggest([msg("c1", "in", "mhero 2 hp?", 0)]);
    // The hand-off promises a person, so one is told.
    assert.deepEqual(labels(s), ["SEND CONTACT FALLBACK — OTHER BRAND MHERO 2", "ALERT SALES — QUESTION"]);
  });
});

describe("quiet for the rest of the chat once a person replies", () => {
  test("a reply a person wrote hands the chat over", () => {
    const s = suggest([msg("c1", "in", "hi", 0), msg("o1", "out", "Hi! How can I help?", 1), msg("c2", "in", "courage", 2)]);
    assert.equal(s.kind, "handed_over");
  });

  test("a TEST phone is always answered: a person's reply does not pause the bot there (Samer, 2026-09-18)", () => {
    const chat = [msg("c1", "in", "hi", 0), msg("o1", "out", "Hi! How can I help?", 1), msg("c2", "in", "courage", 2)];
    assert.equal(suggest(chat).kind, "handed_over", "a customer's chat is still paused");
    const s = suggest(chat, freshSaved(), { alwaysAnswer: true });
    assert.equal(s.kind, "suggestion");
    assert.equal(s.kind === "suggestion" && s.turn.decision.understanding.model, "COURAGE");
    // A person who already answered the customer's last message leaves nothing to answer — the bot does not talk over them.
    assert.equal(suggest([msg("c1", "in", "courage", 0), msg("o1", "out", "Sure, one moment", 1)], freshSaved(), { alwaysAnswer: true }).kind, "nothing_to_answer");
    // "Hand this chat to a person" is a deliberate button, and still holds the bot — on a test phone too.
    const held = { ...freshSaved(), state: { ...freshSaved().state, manualTakeover: true } };
    assert.equal(suggest(chat, held, { alwaysAnswer: true }).kind, "handed_over");
  });

  test("a chat staff already answered before suggestions existed gets none", () => {
    assert.equal(suggest([msg("c1", "in", "price?", 0), msg("o1", "out", "Please call us", 60)]).kind, "handed_over");
  });

  test("our own suggestion sends do not count — by Meta id, or by WhatsApp automation id", () => {
    assert.ok(isOurs(msg("o1", "out", "x", 1), { ...freshSaved(), sentMessageIds: ["o1"] }));
    assert.ok(isOurs(msg("row-uuid", "out", "x", 1, { automationId: `${SUGGESTION_AUTOMATION_PREFIX}:abc:0` }), freshSaved()));
    assert.ok(!isOurs(msg("o2", "out", "x", 1, { automationId: "other:1" }), freshSaved()));
  });

  test("'Suggest again' forgives the replies written until then", () => {
    const thread = [msg("c1", "in", "hi", 0), msg("o1", "out", "Hi!", 1), msg("c2", "in", "courage", 2)];
    const resumed = { ...freshSaved(), resumedAt: new Date(T0 + 90_000).toISOString() };
    assert.equal(suggest(thread, resumed).kind, "suggestion");
    const later = [...thread, msg("o2", "out", "typed by a person", 3), msg("c3", "in", "black", 4)];
    assert.equal(suggest(later, resumed).kind, "handed_over", "a reply after the resume hands it over again");
  });
});

describe("what it can and cannot send", () => {
  test("a closed 24-hour window blocks sending, and says why", () => {
    const s = suggest([msg("c1", "in", "courage", 0)], freshSaved(), { windowOpen: false });
    assert.equal(s.kind === "suggestion" && s.turn.policy.wouldSend, false);
    assert.ok(s.kind === "suggestion" && s.turn.policy.blocked.some((b) => /24-hour/.test(b)));
  });

  test("a brochure too big for Instagram goes as a link in the sentence", () => {
    const s = suggest([msg("c1", "in", "courage", 0)], freshSaved(), {}, deps(31_000_000));
    assert.ok(s.kind === "suggestion");
    if (s.kind === "suggestion") {
      assert.match(planLines(s.turn.plan)[0], /^Here is the VOYAH Courage brochure: https:\/\//);
      assert.ok(!s.turn.plan.some((p) => p.kind === "file" && p.fileKind === "document"));
      assert.equal(s.turn.policy.wouldSend, true);
    }
  });

  test("the same brochure goes as a file on WhatsApp, which takes 100 MB", () => {
    const s = suggest([msg("c1", "in", "courage", 0)], freshSaved(), { channel: "whatsapp", brand: "monza" }, deps(31_000_000));
    assert.ok(s.kind === "suggestion" && s.turn.plan.some((p) => p.kind === "file" && p.fileKind === "document"));
  });

  test("the version changes with a new customer message, and only then", () => {
    const a = suggest([msg("c1", "in", "hi", 0)]);
    const b = suggest([msg("c1", "in", "hi", 0)]);
    const c = suggest([msg("c1", "in", "hi", 0), msg("c2", "in", "courage", 1)]);
    assert.ok(a.kind === "suggestion" && b.kind === "suggestion" && c.kind === "suggestion");
    if (a.kind === "suggestion" && b.kind === "suggestion" && c.kind === "suggestion") {
      assert.equal(a.version, b.version);
      assert.notEqual(a.version, c.version);
    }
  });
});

describe("what is remembered", () => {
  test("after a send: the next state, our ids, and a new rev", () => {
    const s = suggest([msg("c1", "in", "courage", 0)]);
    assert.ok(s.kind === "suggestion");
    if (s.kind !== "suggestion") return;
    const next = afterSend(freshSaved(), s.turn.decision.nextState, ["m1", null, "m2"]);
    assert.deepEqual(next.sentMessageIds, ["m1", "m2"]);
    assert.equal(next.rev, 1);
    assert.equal(next.state.activeModel, "COURAGE");
    const partial = afterSend(next, null, ["m3"]);
    assert.equal(partial.state.activeModel, "COURAGE", "a partial send keeps the old state");
    assert.equal(partial.rev, 2);
  });

  test("a stored row is read defensively", () => {
    const row = savedFromRow({
      state: { version: 1, activeModel: "COURAGE" },
      sent_message_ids: ["a", 5, "b"],
      resumed_at: "not a time",
      rev: 3,
    });
    assert.equal(row.state.activeModel, "COURAGE");
    assert.deepEqual(row.sentMessageIds, ["a", "b"]);
    assert.equal(row.resumedAt, null);
    assert.equal(row.rev, 3);
    assert.deepEqual(savedFromRow(null), freshSaved());
  });
});
