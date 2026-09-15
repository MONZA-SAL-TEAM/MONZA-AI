/**
 * Sending a sales suggestion a person approved (lib/wasales/executor.ts) and
 * the richer requests under it: WhatsApp files by link and tappable choices
 * (lib/channels/whatsapp.ts), Messenger / Instagram quick replies and files by
 * URL (lib/channels/meta-send.ts). The exact request bodies are pinned here.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { checkPlan, executePlan } from "@/lib/wasales/executor";
import { sendWhatsAppChoices, sendWhatsAppLink } from "@/lib/channels/whatsapp";
import {
  FACEBOOK_GRAPH,
  INSTAGRAM_LOGIN_GRAPH,
  metaSendProblem,
  postMetaMessage,
} from "@/lib/channels/meta-send";
import type { OutboundPart } from "@/lib/wasales/templates";

type Call = { url: string; body: Record<string, unknown> };

/** Answers each call in turn with the given statuses (200 when they run out). */
function fakeFetch(calls: Call[], statuses: number[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const status = statuses[calls.length] ?? 200;
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    const body =
      status === 200
        ? { messages: [{ id: `wamid.${calls.length}` }], message_id: `m_${calls.length}` }
        : { error: { code: 100, message: "Invalid parameter" } };
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const PDF = "https://example.supabase.co/storage/v1/object/public/wasales-media/voyah-courage/brochure/x__c.pdf";
const MP4 = "https://example.supabase.co/storage/v1/object/public/wasales-media/voyah-courage/video-send/black/x__b.mp4";

const PLAN: OutboundPart[] = [
  { kind: "text", text: "Here is the Voyah Courage brochure.", choices: [], style: null },
  { kind: "file", fileKind: "document", name: "Voyah courage 2026 catalogue.pdf", bytes: 31_000_000, url: PDF },
  {
    kind: "text",
    text: "Which colour would you like to see?",
    choices: [
      { title: "Black", payload: "COLOUR:COURAGE:BLACK" },
      { title: "Grey", payload: "COLOUR:COURAGE:GREY" },
      { title: "White", payload: "COLOUR:COURAGE:WHITE" },
    ],
    style: "buttons",
  },
];

const WA = { channel: "whatsapp" as const, phoneNumberId: "984244264767607", to: "96170123456", token: "KEY" };

describe("WhatsApp", () => {
  test("text, then the brochure by link with its name, then three reply buttons", async () => {
    const calls: Call[] = [];
    const r = await executePlan(PLAN, WA, fakeFetch(calls));
    assert.equal(r.failed, null);
    assert.equal(r.sent.length, 3);
    assert.ok(calls.every((c) => c.url === "https://graph.facebook.com/v21.0/984244264767607/messages"));
    assert.deepEqual(calls[0].body.text, { preview_url: false, body: "Here is the Voyah Courage brochure." });
    assert.equal(calls[1].body.type, "document");
    assert.deepEqual(calls[1].body.document, { link: PDF, filename: "Voyah courage 2026 catalogue.pdf" });
    assert.equal(calls[2].body.type, "interactive");
    assert.deepEqual(calls[2].body.interactive, {
      type: "button",
      body: { text: "Which colour would you like to see?" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "COLOUR:COURAGE:BLACK", title: "Black" } },
          { type: "reply", reply: { id: "COLOUR:COURAGE:GREY", title: "Grey" } },
          { type: "reply", reply: { id: "COLOUR:COURAGE:WHITE", title: "White" } },
        ],
      },
    });
    assert.deepEqual(r.sent.map((s) => s.record), [
      "Here is the Voyah Courage brochure.",
      "Brochure: Voyah courage 2026 catalogue.pdf",
      "Which colour would you like to see?\n• Black\n• Grey\n• White",
    ]);
  });

  test("a list of up to ten rows", async () => {
    const calls: Call[] = [];
    const choices = ["Voyah Free 318", "Voyah Courage", "Voyah Dream", "Voyah Passion", "Voyah Passion L", "Voyah Taishan"].map(
      (title, i) => ({ id: `MODEL:M${i}`, title })
    );
    const r = await sendWhatsAppChoices({ phoneNumberId: WA.phoneNumberId, to: WA.to, body: "Which model?", style: "list", choices }, "KEY", fakeFetch(calls));
    assert.equal(r.ok, true);
    const interactive = calls[0].body.interactive as { type: string; action: { button: string; sections: { rows: unknown[] }[] } };
    assert.equal(interactive.type, "list");
    assert.equal(interactive.action.button, "Choose");
    assert.equal(interactive.action.sections[0].rows.length, 6);
  });

  test("a video by link", async () => {
    const calls: Call[] = [];
    await sendWhatsAppLink({ phoneNumberId: WA.phoneNumberId, to: WA.to, kind: "video", link: MP4 }, "KEY", fakeFetch(calls));
    assert.deepEqual(calls[0].body.video, { link: MP4 });
  });

  test("over WhatsApp's limits, or not https, is refused before any request", async () => {
    const calls: Call[] = [];
    const four = ["a", "b", "c", "d"].map((t) => ({ id: t, title: t }));
    assert.equal((await sendWhatsAppChoices({ phoneNumberId: WA.phoneNumberId, to: WA.to, body: "?", style: "buttons", choices: four }, "KEY", fakeFetch(calls))).ok, false);
    const long = [{ id: "x", title: "A title far longer than twenty" }];
    assert.equal((await sendWhatsAppChoices({ phoneNumberId: WA.phoneNumberId, to: WA.to, body: "?", style: "buttons", choices: long }, "KEY", fakeFetch(calls))).ok, false);
    assert.equal((await sendWhatsAppLink({ phoneNumberId: WA.phoneNumberId, to: WA.to, kind: "document", link: "http://insecure.example/b.pdf" }, "KEY", fakeFetch(calls))).ok, false);
    assert.equal(calls.length, 0);
  });

  test("it only ever calls /messages — never anything that touches the number's registration", async () => {
    const calls: Call[] = [];
    await executePlan(PLAN, WA, fakeFetch(calls));
    assert.ok(calls.every((c) => c.url.endsWith("/messages")));
    assert.ok(calls.every((c) => !/register|deregister|request_code|verify_code|two_step/.test(c.url)));
  });
});

describe("stopping", () => {
  test("the first failure stops the rest, and says which part", async () => {
    const calls: Call[] = [];
    const r = await executePlan(PLAN, WA, fakeFetch(calls, [200, 400]));
    assert.equal(r.sent.length, 1);
    assert.equal(r.failed?.index, 1);
    assert.equal(calls.length, 2, "the question after the failed brochure was not sent");
  });

  test("a plan that cannot go out whole does not start", async () => {
    const calls: Call[] = [];
    const noUrl: OutboundPart[] = [PLAN[0], { ...PLAN[1], url: null } as OutboundPart];
    const r = await executePlan(noUrl, WA, fakeFetch(calls));
    assert.equal(calls.length, 0);
    assert.match(r.failed?.problem ?? "", /not in the shared library/);
    assert.equal(checkPlan([]), "There is nothing to send.");
  });
});

describe("Messenger and Instagram", () => {
  const quick: OutboundPart = {
    kind: "text",
    text: "Which model are you interested in?",
    choices: [
      { title: "Voyah Courage", payload: "MODEL:COURAGE" },
      { title: "Voyah Dream", payload: "MODEL:DREAM" },
    ],
    style: "quick_replies",
  };

  test("Messenger: quick replies carry the payloads, and the message says it is a RESPONSE", async () => {
    const calls: Call[] = [];
    const r = await executePlan([quick], { channel: "facebook", host: FACEBOOK_GRAPH, recipientId: "123456789", token: "KEY" }, fakeFetch(calls));
    assert.equal(r.failed, null);
    assert.equal(r.sent[0].externalMessageId, "m_1");
    assert.equal(calls[0].url, `${FACEBOOK_GRAPH}/me/messages`);
    assert.deepEqual(calls[0].body, {
      recipient: { id: "123456789" },
      message: {
        text: "Which model are you interested in?",
        quick_replies: [
          { content_type: "text", title: "Voyah Courage", payload: "MODEL:COURAGE" },
          { content_type: "text", title: "Voyah Dream", payload: "MODEL:DREAM" },
        ],
      },
      messaging_type: "RESPONSE",
    });
  });

  test("Instagram through Instagram login: its own host, a file by URL, no messaging_type", async () => {
    const calls: Call[] = [];
    await executePlan([PLAN[1]], { channel: "instagram", host: INSTAGRAM_LOGIN_GRAPH, recipientId: "17841400000000000", token: "KEY" }, fakeFetch(calls));
    assert.equal(calls[0].url, `${INSTAGRAM_LOGIN_GRAPH}/me/messages`);
    assert.deepEqual(calls[0].body, {
      recipient: { id: "17841400000000000" },
      message: { attachment: { type: "file", payload: { url: PDF } } },
    });
  });

  test("only Meta's own hosts, and only a plausible customer id", async () => {
    const calls: Call[] = [];
    const bad = await postMetaMessage({ host: "https://evil.example", token: "K", recipientId: "1", message: {}, messenger: true }, fakeFetch(calls));
    assert.equal(bad.ok, false);
    const noId = await postMetaMessage({ host: FACEBOOK_GRAPH, token: "K", recipientId: "../me", message: {}, messenger: true }, fakeFetch(calls));
    assert.equal(noId.ok, false);
    assert.equal(calls.length, 0);
  });

  test("outside the 24-hour window is reported as the window closing", () => {
    assert.equal(metaSendProblem({ error: { code: 10, error_subcode: 2018278, message: "x" } }, 400).windowClosed, true);
    assert.equal(metaSendProblem({ error: { code: 190 } }, 400).windowClosed, false);
  });
});
