/**
 * The sales autoreply PILOT (Samer, 2026-09-16): who it may answer, how it is
 * switched off, where a chat begins for it, and how its messages are recorded.
 * The sending itself is the suggestion send, tested in sales-executor.test.ts.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { AUTOREPLY_PILOT, autoreplyMode, isPilotAccount, isPilotChat } from "@/lib/wasales/autoreply-pilot";
import { accountsForApp, INSTAGRAM_LOGIN_APPS, withInstagramLoginSecrets } from "@/lib/channels/meta-signature";
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

  /** The four numbers Samer named on 2026-09-18, and nothing else. */
  const PILOT_NUMBERS = ["9613195955", "96181659640", "96178986096", "96176877278"];

  test("only listed chats: an account AND its customer", () => {
    assert.deepEqual(
      AUTOREPLY_PILOT.chats.map((c) => `${c.accountId}:${c.peer}`),
      PILOT_NUMBERS.map((n) => `wa-monza:${n}`)
    );
    assert.equal(isPilotChat(samer), true);
    assert.equal(isPilotChat({ ...samer, peerExternalId: "+961 3 195 955" }), true);
  });

  test("every number Samer named is answered, however it is written", () => {
    for (const n of PILOT_NUMBERS) {
      assert.equal(isPilotChat({ ...samer, peerExternalId: n }), true, n);
      // WhatsApp hands us bare digits, but a stored "+961 81 659 640" is the
      // same chat: isPilotChat strips everything that is not a digit.
      const spaced = `+${n.slice(0, 3)} ${n.slice(3, 5)} ${n.slice(5, 8)} ${n.slice(8)}`;
      assert.equal(isPilotChat({ ...samer, peerExternalId: spaced }), true, spaced);
    }
  });

  test("a number one digit away from a pilot number is NOT answered", () => {
    // The guard that matters when the list stops being one number: these are
    // real Lebanese numbers from the same ranges, and none of them is listed.
    for (const near of ["96181659641", "9617898609", "961769877278", "96176877279"]) {
      assert.equal(isPilotChat({ ...samer, peerExternalId: near }), false, near);
    }
  });

  test("any other customer, account or channel is never answered", () => {
    assert.equal(isPilotChat({ ...samer, peerExternalId: "96170123456" }), false);
    assert.equal(isPilotChat({ ...samer, peerExternalId: "3195955" }), false, "a partial number is not the number");
    assert.equal(isPilotChat({ ...samer, peerExternalId: "19613195955" }), false);
    assert.equal(isPilotChat({ accountId: "ig-voyah", channel: "instagram", peerExternalId: "9613195955" }), false, "the same id on another account is someone else");
    assert.equal(isPilotChat({ ...samer, peerExternalId: "" }), false);
  });

  test("an Instagram chat is matched on its scoped id, exactly", () => {
    const pilot = { chats: [{ accountId: "ig-voyah", peer: "1234567890123456" }] };
    assert.equal(isPilotChat({ accountId: "ig-voyah", channel: "instagram", peerExternalId: "1234567890123456" }, pilot), true);
    assert.equal(isPilotChat({ accountId: "ig-voyah", channel: "instagram", peerExternalId: "123456789012345" }, pilot), false);
    assert.equal(isPilotChat({ accountId: "ig-mhero", channel: "instagram", peerExternalId: "1234567890123456" }, pilot), false);
    assert.equal(isPilotAccount("ig-voyah", pilot), true);
    assert.equal(isPilotAccount("fb-voyah", pilot), false);
  });

  test("the list cannot be changed at run time", () => {
    assert.ok(Object.isFrozen(AUTOREPLY_PILOT));
    assert.ok(Object.isFrozen(AUTOREPLY_PILOT.chats));
    for (const c of AUTOREPLY_PILOT.chats) assert.ok(Object.isFrozen(c));
  });

  test("SALES_AUTOREPLY_MODE=off stops it; anything else leaves it to the list", () => {
    assert.equal(autoreplyMode("off"), "off");
    assert.equal(autoreplyMode(" OFF "), "off");
    for (const v of [undefined, null, "", "pilot", "on", "live"]) assert.equal(autoreplyMode(v), "pilot", String(v));
  });
});

describe("the Instagram app speaks only for Instagram accounts of its brand", () => {
  const accounts = [
    { id: "ig-voyah", channel: "instagram", appId: "912301501380919" },
    { id: "fb-voyah", channel: "facebook", appId: "912301501380919" },
    { id: "wa-monza", channel: "whatsapp", appId: "912301501380919" },
    { id: "ig-mhero", channel: "instagram", appId: "1793221688521200" },
  ];
  test("VOYAH's Instagram app → only ig-voyah", () => {
    assert.deepEqual(accountsForApp(accounts, "2636993883137857").map((a) => a.id), ["ig-voyah"]);
    assert.equal(INSTAGRAM_LOGIN_APPS["2636993883137857"], "912301501380919");
  });
  test("the Facebook app is unchanged, and an unknown app speaks for nobody", () => {
    assert.deepEqual(accountsForApp(accounts, "912301501380919").map((a) => a.id), ["ig-voyah", "fb-voyah", "wa-monza"]);
    assert.deepEqual(accountsForApp(accounts, "999"), []);
    assert.deepEqual(accountsForApp(accounts, "__proto__"), []);
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

describe("the Instagram app secret is its own setting", () => {
  const base = [{ appId: "912301501380919", secret: "fb" }];
  test("it is added, bound to the Instagram app", () => {
    assert.deepEqual(withInstagramLoginSecrets(base, { "2636993883137857": " ig " }), [...base, { appId: "2636993883137857", secret: "ig" }]);
  });
  test("missing or empty adds nothing, and the existing secrets are untouched", () => {
    assert.deepEqual(withInstagramLoginSecrets(base, { "2636993883137857": null }), base);
    assert.deepEqual(withInstagramLoginSecrets(base, { "2636993883137857": "  " }), base);
    assert.deepEqual(withInstagramLoginSecrets([], { "not-an-id": "x" }), []);
  });
});
