/**
 * The sales autoreply PILOT (Samer, 2026-09-16): who it may answer, how it is
 * switched off, where a chat begins for it, and how its messages are recorded.
 * The sending itself is the suggestion send, tested in sales-executor.test.ts.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { AUTOREPLY_PILOT, autoreplyMode, isPilotChat } from "@/lib/wasales/autoreply-pilot";
import {
  AUTOREPLY_AUTOMATION_PREFIX,
  freshSaved,
  isOurs,
  suggestForThread,
} from "@/lib/wasales/suggest";
import { whatsappSentRow } from "@/lib/channels/whatsapp";
import { libraryMedia } from "@/lib/wasales/catalog";
import { MONZA_KNOWLEDGE } from "@/lib/wasales/knowledge";
import { actionLabel } from "@/lib/wasales/templates";
import type { InboxMessage } from "@/lib/inbox/types";
import type { WaCar } from "@/lib/wasales/matcher";

describe("who the pilot may answer", () => {
  const samer = { accountId: "wa-monza", channel: "whatsapp", peerExternalId: "9613195955" };

  test("only Samer's test phone, on the business WhatsApp", () => {
    assert.deepEqual([...AUTOREPLY_PILOT.accounts], ["wa-monza"]);
    assert.deepEqual([...AUTOREPLY_PILOT.peers], ["9613195955"]);
    assert.equal(isPilotChat(samer), true);
    assert.equal(isPilotChat({ ...samer, peerExternalId: "+961 3 195 955".replace(/\s/g, "").replace("+961", "961") }), true);
  });

  test("any other customer, account or channel is never answered", () => {
    assert.equal(isPilotChat({ ...samer, peerExternalId: "96170123456" }), false);
    assert.equal(isPilotChat({ ...samer, peerExternalId: "3195955" }), false, "a partial number is not the number");
    assert.equal(isPilotChat({ ...samer, peerExternalId: "19613195955" }), false);
    assert.equal(isPilotChat({ ...samer, accountId: "ig-voyah" }), false);
    assert.equal(isPilotChat({ ...samer, channel: "instagram" }), false);
    assert.equal(isPilotChat({ ...samer, peerExternalId: "" }), false);
  });

  test("the list cannot be changed at run time", () => {
    assert.ok(Object.isFrozen(AUTOREPLY_PILOT));
    assert.ok(Object.isFrozen(AUTOREPLY_PILOT.peers));
  });

  test("SALES_AUTOREPLY_MODE=off stops it; anything else leaves it to the list", () => {
    assert.equal(autoreplyMode("off"), "off");
    assert.equal(autoreplyMode(" OFF "), "off");
    for (const v of [undefined, null, "", "pilot", "on", "live"]) assert.equal(autoreplyMode(v), "pilot", String(v));
  });
});

describe("where a chat begins for the pilot", () => {
  const car = (id: string, name: string, aliases: string[], colours: string[]): WaCar => ({
    id,
    name,
    enabled: true,
    aliases,
    videos: [],
    colours: colours.map((c) => ({ id: c, name: c.charAt(0).toUpperCase() + c.slice(1), aliases: [c] })),
    brochure: null,
    oneLiner: "",
  });
  const catalog = [car("voyah-courage", "Voyah Courage", ["courage"], ["black", "grey"]), car("mhero-2", "Mhero 2", ["mhero 2"], ["black"])];
  const deps = { knowledge: MONZA_KNOWLEDGE, catalog, media: libraryMedia([]), ttlHours: 72 };
  const T0 = Date.parse("2026-09-16T09:00:00.000Z");
  const m = (id: string, direction: "in" | "out", text: string, minutes: number, extra: Partial<InboxMessage> = {}): InboxMessage => ({
    id,
    conversationId: "wa-monza~c1",
    direction,
    author: direction === "in" ? "customer" : "staff",
    text,
    at: new Date(T0 + minutes * 60_000).toISOString(),
    status: direction === "in" ? "received" : "sent",
    ...extra,
  });

  // Yesterday's tests: a customer hello and a reply typed on the business phone.
  const history = [m("old1", "in", "test", -600), m("old2", "out", "hello from the phone", -590)];

  test("without a start, yesterday's typed reply hands the chat to people", () => {
    assert.equal(suggestForThread({ brand: "monza", channel: "whatsapp", messages: [...history, m("c1", "in", "hi", 0)], windowOpen: true }, freshSaved(), deps, { liveSending: true }).kind, "handed_over");
  });

  test("with a start just before the new message, it is a new conversation: welcome and the models", () => {
    const saved = { ...freshSaved(), startedAt: new Date(T0 - 1).toISOString(), rev: 1 };
    const s = suggestForThread({ brand: "monza", channel: "whatsapp", messages: [...history, m("c1", "in", "hi", 0)], windowOpen: true }, saved, deps, { liveSending: true });
    assert.equal(s.kind, "suggestion");
    if (s.kind === "suggestion") {
      assert.deepEqual(s.turn.decision.actions.map(actionLabel), ["SHOW MODEL CHOICES (COURAGE, MHERO 2)"]);
      const first = s.turn.plan[0];
      assert.ok(first.kind === "text" && first.text.startsWith("Hello and welcome to Monza!"));
    }
  });

  test("the pilot's own messages never hand the chat over", () => {
    assert.ok(isOurs(m("row", "out", "x", 1, { automationId: `${AUTOREPLY_AUTOMATION_PREFIX}:abc:0` }), freshSaved()));
  });
});

describe("how the pilot's messages are recorded", () => {
  test("as automation, with its automation id — shown as Automatic in the inbox", () => {
    const row = whatsappSentRow({
      conversationId: "c1",
      brand: "monza",
      accountId: "wa-monza",
      externalMessageId: "wamid.1",
      text: "Here is the Voyah Courage brochure.",
      at: "2026-09-16T09:00:00.000Z",
      staffName: "Sales engine",
      author: "automation",
      automationId: `${AUTOREPLY_AUTOMATION_PREFIX}:v:0`,
    });
    assert.equal(row.author, "automation");
    assert.equal(row.automation_id, "sales-autoreply:v:0");
    assert.equal(whatsappSentRow({ conversationId: "c", brand: "monza", accountId: "wa-monza", externalMessageId: "w", text: "t", at: "2026-09-16T09:00:00.000Z", staffName: "s" }).author, "staff");
  });
});
