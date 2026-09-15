/**
 * WhatsApp in the inbox (2026-09-15).
 *
 * WhatsApp is the one channel MONZA AI stores, by Samer's decision, because
 * Meta offers no way to read it back. What is pinned down here:
 *
 *   - a delivery is routed by the NUMBER it reached (phone_number_id), and an
 *     unknown number is never filed under a brand;
 *   - the customer's words, name and ad referral are read; receipts,
 *     reactions and system notices are not messages;
 *   - staff replies typed in the WhatsApp app (echoes) come back as OUR side
 *     of the thread, addressed to the customer;
 *   - WhatsApp rows keep their words while Instagram's still cannot;
 *   - the 12-month clean-up refuses anybody but the daily job.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  WA_ATTACHMENT_ONLY,
  WHATSAPP_STAFF_NAME,
  contentOf,
  displayPhone,
  mapWhatsAppConversation,
  mapWhatsAppMessage,
  parseWhatsApp,
  parseWhatsAppStatuses,
  sendWhatsAppMedia,
  sendWhatsAppText,
  statusesBefore,
  uploadWhatsAppMedia,
  waTime,
  whatsappMessageRow,
  whatsappSendProblem,
  whatsappSentRow,
} from "@/lib/channels/whatsapp";
import { parseInstagram } from "@/lib/channels/instagram";
import { messengerAdapter } from "@/lib/channels/messenger";
import { decodeThreadId, inboundIndexRow, redactDelivery } from "@/lib/channels/live-map";
import { isCronAuthorized, retentionCutoff } from "@/lib/channels/retention";
import type { ChannelAccount } from "@/lib/channels/types";

const PHONE_ID = "984244264767607";
const WABA = "1502691630809243";
const CUSTOMER = "96170123456";

const ACCOUNTS: ChannelAccount[] = [
  {
    id: "wa-monza",
    channel: "whatsapp",
    displayName: "+961 70 708 585",
    externalId: PHONE_ID,
    portfolio: "VoyahLebanon 1235692167762623",
    tokenEnv: "META_TOKEN_WHATSAPP",
  },
  {
    id: "ig-voyah",
    channel: "instagram",
    displayName: "@voyahlebanon",
    // The same string as the WhatsApp number on purpose: routing must use the
    // channel too, never the id alone.
    externalId: PHONE_ID,
    portfolio: "VoyahLebanon 1235692167762623",
    tokenEnv: "META_TOKEN_VOYAH",
  },
];

function delivery(field: string, value: Record<string, unknown>, phoneId = PHONE_ID) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: WABA,
        changes: [
          {
            field,
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "96170708585", phone_number_id: phoneId },
              ...value,
            },
          },
        ],
      },
    ],
  };
}

const TEXT = delivery("messages", {
  contacts: [{ profile: { name: "Rami K" }, wa_id: CUSTOMER }],
  messages: [
    { from: CUSTOMER, id: "wamid.1", timestamp: "1757930400", type: "text", text: { body: "Is the Free available in white?" } },
  ],
});

describe("parsing a WhatsApp delivery", () => {
  test("a text message: the number it reached, who wrote, their name, their words, when", () => {
    const [e, ...rest] = parseWhatsApp(TEXT, ACCOUNTS);
    assert.equal(rest.length, 0);
    assert.equal(e.accountId, "wa-monza");
    assert.equal(e.fromExternalId, CUSTOMER);
    assert.equal(e.fromDisplay, "Rami K");
    assert.equal(e.text, "Is the Free available in white?");
    assert.equal(e.externalMessageId, "wamid.1");
    assert.equal(e.direction, "in");
    assert.equal(e.at, new Date(1757930400 * 1000).toISOString(), "SECONDS, from the payload");
  });

  test("WhatsApp timestamps are seconds, and a missing one falls back", () => {
    assert.equal(waTime("1757930400", "x"), new Date(1757930400_000).toISOString());
    assert.equal(waTime(undefined, "fallback"), "fallback");
    assert.equal(waTime("nonsense", "fallback"), "fallback");
  });

  test("an unknown number is left unmatched, never filed under a brand (rule 1)", () => {
    const toUnknownNumber = delivery(
      "messages",
      {
        contacts: [{ profile: { name: "Rami K" }, wa_id: CUSTOMER }],
        messages: [{ from: CUSTOMER, id: "wamid.u", timestamp: "1757930400", type: "text", text: { body: "hi" } }],
      },
      "111"
    );
    const [e] = parseWhatsApp(toUnknownNumber, ACCOUNTS);
    assert.equal(e.accountId, null);
  });

  test("an Instagram account with the same id is NOT a WhatsApp number", () => {
    const onlyIg = ACCOUNTS.filter((a) => a.channel === "instagram");
    assert.equal(parseWhatsApp(TEXT, onlyIg)[0].accountId, null);
  });

  test("photos, voice notes, files and stickers are messages even without words — known by id, never by URL", () => {
    const d = delivery("messages", {
      messages: [
        { from: CUSTOMER, id: "wamid.2", timestamp: "1757930401", type: "image", image: { id: "1001", mime_type: "image/jpeg", sha256: "abc", caption: "my car", url: "https://lookaside.fbsbx.com/x" } },
        { from: CUSTOMER, id: "wamid.3", timestamp: "1757930402", type: "audio", audio: { id: "1002", mime_type: "audio/ogg; codecs=opus", voice: true } },
        { from: CUSTOMER, id: "wamid.4", timestamp: "1757930403", type: "document", document: { id: "1003", mime_type: "application/pdf", filename: "Offer.pdf" } },
        { from: CUSTOMER, id: "wamid.4s", timestamp: "1757930403", type: "sticker", sticker: { id: "1004", mime_type: "image/webp", animated: false } },
      ],
    });
    const events = parseWhatsApp(d, ACCOUNTS);
    assert.deepEqual(events.map((e) => e.text), ["my car", "", "", ""]);
    assert.deepEqual(events.map((e) => e.attachments[0]?.kind), ["image", "audio", "file", "sticker"]);
    assert.deepEqual(events[0].attachments[0], { kind: "image", url: null, mediaId: "1001", mime: "image/jpeg", sha256: "abc" });
    assert.equal(events[1].attachments[0].voice, true, "a voice note, not just an audio file");
    assert.equal(events[2].attachments[0].filename, "Offer.pdf");
  });

  test("a shared location keeps its place; a contact card keeps name and number", () => {
    const loc = contentOf({ type: "location", location: { latitude: 33.8938, longitude: 35.5018, name: "Monza showroom" } });
    assert.equal(loc?.text, "Shared a location: Monza showroom");
    assert.deepEqual(loc?.attachments, [{ kind: "location", url: null, lat: 33.8938, lng: 35.5018, label: "Monza showroom" }]);
    assert.deepEqual(contentOf({ type: "location", location: { latitude: 999, longitude: 0 } })?.attachments, [], "not a place on Earth");

    const card = contentOf({
      type: "contacts",
      contacts: [{ name: { formatted_name: "Rami K", first_name: "Rami" }, phones: [{ phone: "+961 70 123 456", wa_id: CUSTOMER }] }],
    });
    assert.equal(card?.text, "Shared a contact card");
    assert.deepEqual(card?.attachments, [{ kind: "contact", url: null, name: "Rami K", phone: "+961 70 123 456" }]);
  });

  test("button and list answers carry the words the customer tapped", () => {
    assert.equal(contentOf({ type: "interactive", interactive: { type: "button_reply", button_reply: { id: "b", title: "Book a test drive" } } })?.text, "Book a test drive");
    assert.equal(contentOf({ type: "interactive", interactive: { type: "list_reply", list_reply: { id: "l", title: "Voyah Courage" } } })?.text, "Voyah Courage");
    assert.equal(contentOf({ type: "button", button: { text: "Yes please" } })?.text, "Yes please");
    assert.match(contentOf({ type: "location", location: { name: "Monza showroom" } })?.text ?? "", /Monza showroom/);
  });

  test("a click-to-WhatsApp ad referral is kept whole, with its click id", () => {
    const d = delivery("messages", {
      messages: [
        {
          from: CUSTOMER,
          id: "wamid.5",
          timestamp: "1757930404",
          type: "text",
          text: { body: "Can I know more info?" },
          referral: {
            source_url: "https://fb.me/ad",
            source_id: "120210000000",
            source_type: "ad",
            headline: "VOYAH Courage — book a test drive",
            media_type: "video",
            ctwa_clid: "ARAkLkA8rmlFeiCktEJQ",
          },
        },
      ],
    });
    const r = parseWhatsApp(d, ACCOUNTS)[0].referral;
    assert.ok(r);
    assert.equal(r.ctwaClid, "ARAkLkA8rmlFeiCktEJQ");
    assert.equal(r.ref, "120210000000");
    assert.equal(r.source, "ad");
    assert.equal(r.headline, "VOYAH Courage — book a test drive");
  });

  test("delivery receipts, reactions and system notices are not messages", () => {
    const d = delivery("messages", {
      statuses: [{ id: "wamid.1", status: "read", timestamp: "1757930500", recipient_id: CUSTOMER }],
      messages: [
        { from: CUSTOMER, id: "wamid.6", timestamp: "1757930405", type: "reaction", reaction: { message_id: "wamid.1", emoji: "👍" } },
        { from: CUSTOMER, id: "wamid.7", timestamp: "1757930406", type: "unsupported" },
        { from: CUSTOMER, id: "wamid.8", timestamp: "1757930407", type: "system", system: { body: "changed number" } },
      ],
    });
    assert.deepEqual(parseWhatsApp(d, ACCOUNTS), []);
  });

  test("a message without an id or a sender is dropped — nothing to key a redelivery on", () => {
    const d = delivery("messages", {
      messages: [
        { from: CUSTOMER, timestamp: "1757930408", type: "text", text: { body: "no id" } },
        { id: "wamid.9", timestamp: "1757930409", type: "text", text: { body: "no sender" } },
      ],
    });
    assert.deepEqual(parseWhatsApp(d, ACCOUNTS), []);
  });
});

describe("staff replies typed in the WhatsApp app (echoes)", () => {
  const ECHO = delivery("smb_message_echoes", {
    message_echoes: [
      { from: "96170708585", to: CUSTOMER, id: "wamid.10", timestamp: "1757930500", type: "text", text: { body: "Yes, we have it in white." } },
    ],
  });

  test("come back as OUR side, in the customer's thread", () => {
    const [e] = parseWhatsApp(ECHO, ACCOUNTS);
    assert.equal(e.direction, "out");
    assert.equal(e.fromExternalId, CUSTOMER, "the thread is keyed on the customer, not our number");
    assert.equal(e.text, "Yes, we have it in white.");
    assert.equal(e.referral, null);
    assert.equal(e.fromDisplay, null, "an echo carries no name, so it can never erase theirs");
  });

  test("edits and revokes are not new messages", () => {
    const d = delivery("smb_message_echoes", {
      message_echoes: [
        { from: "96170708585", to: CUSTOMER, id: "wamid.11", timestamp: "1757930501", type: "edit", edit: {} },
        { from: "96170708585", to: CUSTOMER, id: "wamid.12", timestamp: "1757930502", type: "revoke", revoke: {} },
      ],
    });
    assert.deepEqual(parseWhatsApp(d, ACCOUNTS), []);
  });

  test("other fields on the WhatsApp object are ignored", () => {
    assert.deepEqual(parseWhatsApp(delivery("account_update", { event: "PARTNER_ADDED" }), ACCOUNTS), []);
  });
});

describe("each adapter reads only its own envelope", () => {
  const IG = {
    object: "instagram",
    entry: [{ id: PHONE_ID, time: 1, messaging: [{ sender: { id: "IGSID" }, recipient: { id: PHONE_ID }, timestamp: 1, message: { mid: "m.1", text: "hi" } }] }],
  };

  test("WhatsApp ignores Instagram, and Instagram and Messenger ignore WhatsApp", () => {
    assert.deepEqual(parseWhatsApp(IG, ACCOUNTS), []);
    assert.deepEqual(parseInstagram(TEXT, ACCOUNTS), []);
    assert.deepEqual(messengerAdapter.parse(TEXT, ACCOUNTS), []);
  });
});

describe("what is stored", () => {
  test("a WhatsApp row keeps the words — deliberately, WhatsApp cannot be read back", () => {
    const [e] = parseWhatsApp(TEXT, ACCOUNTS);
    const row = whatsappMessageRow({ conversationId: "c1", brand: "monza", accountId: "wa-monza", event: e });
    assert.equal(row.body, "Is the Free available in white?");
    assert.equal(row.direction, "in");
    assert.equal(row.author, "customer");
    assert.equal(row.status, "received");
    assert.equal(row.external_message_id, "wamid.1");
    assert.equal(row.sent_at, e.at);
  });

  test("an echo is stored as a staff message", () => {
    const row = whatsappMessageRow({
      conversationId: "c1",
      brand: "monza",
      accountId: "wa-monza",
      event: { ...parseWhatsApp(TEXT, ACCOUNTS)[0], direction: "out" },
    });
    assert.equal(row.direction, "out");
    assert.equal(row.author, "staff");
    assert.equal(row.status, "sent");
    assert.equal(row.staff_name, WHATSAPP_STAFF_NAME);
  });

  // Samer, 2026-09-15: files are kept, like the words, for 12 months. Meta
  // keeps a received file 7 days, so the row holds its id until it is copied.
  test("a file is stored by its media id, waiting to be copied — never Meta's 5-minute URL", () => {
    const d = delivery("messages", {
      messages: [
        { from: CUSTOMER, id: "wamid.13", timestamp: "1757930410", type: "image", image: { id: "1005", mime_type: "image/jpeg", url: "https://lookaside.fbsbx.com/x" } },
        { from: CUSTOMER, id: "wamid.14", timestamp: "1757930411", type: "image", image: {} },
      ],
    });
    const [withId, withoutId] = parseWhatsApp(d, ACCOUNTS).map((event) =>
      whatsappMessageRow({ conversationId: "c1", brand: "monza", accountId: "wa-monza", event })
    );
    assert.deepEqual(withId.attachments, [{ kind: "image", mediaId: "1005", mime: "image/jpeg", state: "pending" }]);
    assert.ok(!JSON.stringify(withId.attachments).includes("lookaside"), "no URL is stored");
    assert.deepEqual(withoutId.attachments, [{ kind: "image", state: "unavailable" }], "nothing to fetch");
  });

  test("Instagram and Facebook rows STILL cannot hold words", () => {
    const row = inboundIndexRow({ conversationId: "c1", brand: "voyah", accountId: "ig-voyah", externalMessageId: "m.1", at: "2026-09-15T10:00:00.000Z" });
    assert.equal(row.body, "");
  });
});

describe("reading WhatsApp back for the inbox", () => {
  const ACCOUNT = { id: "wa-monza", brand: "monza", displayName: "+961 70 708 585" };
  const ROW = {
    id: "0b7e4b8e-4a4e-4b3e-9c1f-2d8f7a6c5e41",
    peer_external_id: CUSTOMER,
    peer_display: "Rami K",
    customer_id: null,
    status: "open",
    last_inbound_at: "2026-09-15 10:00:00+00",
    last_message_at: "2026-09-15 10:00:00+00",
    last_body: "Is the Free available in white?",
    last_direction: "in",
    last_author: "customer",
    last_sent_at: "2026-09-15 10:00:00+00",
    last_attachments: 0,
  };

  test("a conversation row becomes an inbox row under the number's brand", () => {
    const c = mapWhatsAppConversation(ROW, ACCOUNT);
    assert.equal(c.channel, "whatsapp");
    assert.equal(c.customerName, "Rami K");
    assert.equal(c.peerPhone, "+961 70 123 456");
    assert.equal(c.brand, "monza");
    assert.equal(c.accountId, "wa-monza");
    assert.equal(c.lastMessage.at, "2026-09-15T10:00:00.000Z", "normalised, so it sorts beside Instagram");
    assert.deepEqual(decodeThreadId(c.id), { accountId: "wa-monza", metaConversationId: ROW.id });
  });

  test("with no name, the formatted number stands in", () => {
    assert.equal(mapWhatsAppConversation({ ...ROW, peer_display: null }, ACCOUNT).customerName, "+961 70 123 456");
  });

  test("a photo-only last message reads as one, and our reply is 'waiting'", () => {
    const c = mapWhatsAppConversation(
      { ...ROW, last_body: "", last_attachments: 1, last_direction: "out", status: "nonsense" },
      ACCOUNT
    );
    assert.equal(c.lastMessage.text, WA_ATTACHMENT_ONLY, "009's count, before migration 010");
    assert.equal(c.lastMessage.direction, "out");
    assert.equal(c.status, "waiting_reply");

    const voice = mapWhatsAppConversation(
      { ...ROW, last_body: "", last_attachments: [{ kind: "audio", voice: true, state: "stored", path: "p" }] },
      ACCOUNT
    );
    assert.equal(voice.lastMessage.text, "🎤 Voice message", "010's list says what it was");
    const pdf = mapWhatsAppConversation(
      { ...ROW, last_body: "", last_attachments: [{ kind: "file", filename: "Offer.pdf", state: "pending" }] },
      ACCOUNT
    );
    assert.equal(pdf.lastMessage.text, "📄 Offer.pdf");
  });

  const threadId = "wa-monza~" + ROW.id;
  const NOW = Date.parse("2026-09-15T12:00:00.000Z");

  test("messages map with their side and author", () => {
    const inbound = mapWhatsAppMessage(
      { id: "m1", direction: "in", author: "customer", body: "hello", attachments: [], status: "received", staff_name: null, sent_at: "2026-09-15 10:00:00+00" },
      threadId
    );
    assert.equal(inbound.direction, "in");
    assert.equal(inbound.author, "customer");
    assert.equal(inbound.at, "2026-09-15T10:00:00.000Z");
    assert.equal(inbound.attachments, undefined);
    const ours = mapWhatsAppMessage(
      { id: "m2", direction: "out", author: "staff", body: "", attachments: [{ kind: "image" }], status: "sent", staff_name: null, sent_at: "2026-09-15 10:05:00+00" },
      threadId,
      undefined,
      NOW
    );
    assert.equal(ours.author, "staff");
    assert.equal(ours.text, "", "the photo itself says what it is");
    assert.deepEqual(ours.attachments, [{ kind: "image", state: "unavailable" }], "a photo from before files were kept");
    assert.equal(ours.staffName, WHATSAPP_STAFF_NAME);
  });

  test("a kept file comes with its short-lived link; a waiting one past Meta's 7 days is gone", () => {
    const links = new Map([["in/wa-monza/c/w-0.jpg", { url: "https://signed/x", expiresAt: "2026-09-15T12:59:00.000Z" }]]);
    const kept = mapWhatsAppMessage(
      { id: "m3", direction: "in", author: "customer", body: "my car", attachments: [{ kind: "image", state: "stored", path: "in/wa-monza/c/w-0.jpg", mime: "image/jpeg" }], status: "received", staff_name: null, sent_at: "2026-09-15 11:00:00+00" },
      threadId,
      links,
      NOW
    );
    assert.equal(kept.text, "my car");
    assert.equal(kept.attachments?.[0].state, "ready");
    assert.equal(kept.attachments?.[0].url, "https://signed/x");

    const waiting = { id: "m4", direction: "in", author: "customer", body: "", attachments: [{ kind: "audio", voice: true, state: "pending", mediaId: "1" }], status: "received", staff_name: null };
    assert.equal(mapWhatsAppMessage({ ...waiting, sent_at: "2026-09-15 11:59:00+00" }, threadId, links, NOW).attachments?.[0].state, "pending");
    assert.equal(mapWhatsAppMessage({ ...waiting, sent_at: "2026-09-01 11:59:00+00" }, threadId, links, NOW).attachments?.[0].state, "unavailable");
  });

  test("our messages carry their ticks, and a failure its reason", () => {
    const base = { id: "m5", direction: "out", author: "staff", body: "hi", attachments: [], staff_name: "samer", sent_at: "2026-09-15 11:00:00+00" };
    assert.equal(mapWhatsAppMessage({ ...base, status: "read" }, threadId).status, "read");
    assert.equal(mapWhatsAppMessage({ ...base, status: "delivered" }, threadId).status, "delivered");
    assert.equal(mapWhatsAppMessage({ ...base, status: "nonsense" }, threadId).status, "sent");
    const failed = mapWhatsAppMessage({ ...base, status: "failed", error: "Message undeliverable" }, threadId);
    assert.equal(failed.status, "failed");
    assert.equal(failed.error, "Message undeliverable");
  });

  test("Lebanese numbers are shown the way people write them", () => {
    assert.equal(displayPhone("96170708585"), "+961 70 708 585");
    assert.equal(displayPhone("9613123456"), "+961 3 123 456");
    assert.equal(displayPhone("447700900123"), "+447700900123");
    assert.equal(displayPhone(""), "");
  });
});

describe("sending a reply (a person pressed Send)", () => {
  type Call = { url: string; init: RequestInit };
  function fakeFetch(status: number, body: unknown, calls: Call[]): typeof fetch {
    return (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
  }

  test("the request: the number's id in the path, digits-only recipient, plain text", async () => {
    const calls: Call[] = [];
    const r = await sendWhatsAppText(
      { phoneNumberId: PHONE_ID, to: "+961 70 123 456", text: "Yes, we have it in white." },
      "KEY",
      fakeFetch(200, { messaging_product: "whatsapp", messages: [{ id: "wamid.sent1" }] }, calls)
    );
    assert.deepEqual(r, { ok: true, externalMessageId: "wamid.sent1" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`);
    assert.equal(calls[0].init.method, "POST");
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer KEY");
    const sent = JSON.parse(String(calls[0].init.body));
    assert.deepEqual(sent, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "96170123456",
      type: "text",
      text: { preview_url: false, body: "Yes, we have it in white." },
    });
  });

  test("it only ever calls /messages and /media — never anything that touches the number's registration", async () => {
    const calls: Call[] = [];
    const ok = fakeFetch(200, { id: "555", messages: [{ id: "w" }] }, calls);
    await sendWhatsAppText({ phoneNumberId: PHONE_ID, to: CUSTOMER, text: "hi" }, "KEY", ok);
    await uploadWhatsAppMedia({ phoneNumberId: PHONE_ID, bytes: new Uint8Array([1, 2, 3]), mime: "image/jpeg", filename: "a.jpg" }, "KEY", ok);
    await sendWhatsAppMedia({ phoneNumberId: PHONE_ID, to: CUSTOMER, kind: "image", mediaId: "555" }, "KEY", ok);
    assert.equal(calls.length, 3);
    assert.ok(calls.every((c) => c.url.endsWith("/messages") || c.url.endsWith("/media")));
    assert.ok(calls.every((c) => !/register|deregister|request_code|verify_code|settings|two_step/.test(c.url)));
  });

  test("a file is handed to WhatsApp as multipart, to the number's own /media", async () => {
    const calls: Call[] = [];
    const r = await uploadWhatsAppMedia(
      { phoneNumberId: PHONE_ID, bytes: new Uint8Array([0xff, 0xd8, 0xff]), mime: "image/jpeg", filename: "car.jpg" },
      "KEY",
      fakeFetch(200, { id: "1234567" }, calls)
    );
    assert.deepEqual(r, { ok: true, mediaId: "1234567" });
    assert.equal(calls[0].url, `https://graph.facebook.com/v21.0/${PHONE_ID}/media`);
    assert.equal(calls[0].init.method, "POST");
    const form = calls[0].init.body as FormData;
    assert.ok(form instanceof FormData);
    assert.equal(form.get("messaging_product"), "whatsapp");
    assert.equal(form.get("type"), "image/jpeg");
    assert.equal((form.get("file") as File).name, "car.jpg");
    assert.equal((form.get("file") as File).size, 3);
  });

  test("each kind goes out in WhatsApp's shape: captions, a document's name, voice notes", async () => {
    const bodyOf = async (input: Parameters<typeof sendWhatsAppMedia>[0]) => {
      const calls: Call[] = [];
      await sendWhatsAppMedia(input, "KEY", fakeFetch(200, { messages: [{ id: "w" }] }, calls));
      return JSON.parse(String(calls[0].init.body));
    };
    const base = { phoneNumberId: PHONE_ID, to: "+961 70 123 456", mediaId: "555" };
    assert.deepEqual(await bodyOf({ ...base, kind: "image", caption: "The white one" }), {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "96170123456",
      type: "image",
      image: { id: "555", caption: "The white one" },
    });
    assert.deepEqual((await bodyOf({ ...base, kind: "document", caption: "Offer", filename: "Offer.pdf" })).document, {
      id: "555",
      caption: "Offer",
      filename: "Offer.pdf",
    });
    assert.deepEqual((await bodyOf({ ...base, kind: "audio", voice: true, caption: "ignored" })).audio, { id: "555", voice: true }, "audio carries no caption");
    assert.deepEqual((await bodyOf({ ...base, kind: "video" })).video, { id: "555" });
  });

  test("a number id that is not digits is refused before any request", async () => {
    const calls: Call[] = [];
    const r = await sendWhatsAppText({ phoneNumberId: "123/../me", to: CUSTOMER, text: "hi" }, "KEY", fakeFetch(200, {}, calls));
    assert.equal(r.ok, false);
    assert.equal(calls.length, 0);
  });

  test("more than 24 hours is reported as the window closing, in words", async () => {
    const r = await sendWhatsAppText(
      { phoneNumberId: PHONE_ID, to: CUSTOMER, text: "hi" },
      "KEY",
      fakeFetch(400, { error: { code: 131047, message: "Re-engagement message" } }, [])
    );
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.windowClosed, true);
    assert.match(!r.ok ? r.problem : "", /24 hours/);
  });

  test("other refusals say what to do, and never claim it went", () => {
    assert.match(whatsappSendProblem({ error: { code: 190 } }, 401).problem, /invalid or has expired/);
    assert.match(whatsappSendProblem({ error: { code: 200 } }, 403).problem, /not allowed to send/);
    assert.match(whatsappSendProblem({ error: { code: 131026 } }, 400).problem, /could not deliver/);
    assert.match(whatsappSendProblem(null, 429).problem, /limiting/);
  });

  test("a network failure is 'not confirmed', not 'failed'", async () => {
    const broken = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const r = await sendWhatsAppText({ phoneNumberId: PHONE_ID, to: CUSTOMER, text: "hi" }, "KEY", broken);
    assert.match(!r.ok ? r.problem : "", /nothing was confirmed/);
  });

  test("what was sent is recorded as our side, under WhatsApp's own id", () => {
    const row = whatsappSentRow({
      conversationId: "c1",
      brand: "monza",
      accountId: "wa-monza",
      externalMessageId: "wamid.sent1",
      text: "Yes, we have it in white.",
      at: "2026-09-15T11:00:00.000Z",
      staffName: "samer",
    });
    assert.equal(row.direction, "out");
    assert.equal(row.author, "staff");
    assert.equal(row.status, "sent");
    assert.equal(row.body, "Yes, we have it in white.");
    assert.equal(row.external_message_id, "wamid.sent1");
    assert.equal(row.staff_name, "samer");
    assert.deepEqual(row.attachments, []);

    const withFile = whatsappSentRow({
      conversationId: "c1",
      brand: "monza",
      accountId: "wa-monza",
      externalMessageId: "wamid.sent2",
      text: "",
      at: "2026-09-15T11:01:00.000Z",
      staffName: "samer",
      attachment: { kind: "audio", voice: true, mime: "audio/ogg", path: "out/wa-monza/c1/x.ogg", state: "stored", size: 9000 },
    });
    assert.deepEqual(withFile.attachments, [{ kind: "audio", voice: true, mime: "audio/ogg", path: "out/wa-monza/c1/x.ogg", state: "stored", size: 9000 }]);
  });
});

describe("ticks: delivery and read receipts", () => {
  const RECEIPTS = delivery("messages", {
    statuses: [
      { id: "wamid.a", status: "sent", timestamp: "1", recipient_id: CUSTOMER },
      { id: "wamid.b", status: "delivered", timestamp: "2", recipient_id: CUSTOMER },
      { id: "wamid.c", status: "read", timestamp: "3", recipient_id: CUSTOMER },
      { id: "wamid.d", status: "played", timestamp: "4", recipient_id: CUSTOMER },
      { id: "wamid.e", status: "failed", timestamp: "5", recipient_id: CUSTOMER, errors: [{ code: 131026, title: "Message undeliverable" }] },
      { id: "wamid.f", status: "deleted", timestamp: "6", recipient_id: CUSTOMER },
    ],
  });

  test("are read for our number, and are not messages", () => {
    assert.deepEqual(parseWhatsAppStatuses(RECEIPTS, ACCOUNTS), [
      { accountId: "wa-monza", externalMessageId: "wamid.a", status: "sent", error: null },
      { accountId: "wa-monza", externalMessageId: "wamid.b", status: "delivered", error: null },
      { accountId: "wa-monza", externalMessageId: "wamid.c", status: "read", error: null },
      { accountId: "wa-monza", externalMessageId: "wamid.d", status: "read", error: null },
      { accountId: "wa-monza", externalMessageId: "wamid.e", status: "failed", error: "Message undeliverable" },
    ]);
    assert.deepEqual(parseWhatsApp(RECEIPTS, ACCOUNTS), [], "a receipt never becomes a message (rule 19)");
  });

  test("an unknown number's receipts move nothing", () => {
    const d = delivery("messages", { statuses: [{ id: "wamid.x", status: "read", timestamp: "1" }] }, "111");
    assert.deepEqual(parseWhatsAppStatuses(d, ACCOUNTS), []);
  });

  test("ticks only move forward: a late 'delivered' cannot undo 'read'", () => {
    assert.deepEqual(statusesBefore("sent"), ["queued"]);
    assert.deepEqual(statusesBefore("delivered"), ["queued", "sent"]);
    assert.deepEqual(statusesBefore("read"), ["queued", "sent", "delivered"]);
    assert.deepEqual(statusesBefore("failed"), ["queued", "sent"], "a delivered message is not re-marked failed");
  });
});

describe("the delivery record says what KIND of thing arrived — never its words", () => {
  test("a WhatsApp message and a read receipt are told apart", () => {
    const kept = redactDelivery(TEXT);
    assert.deepEqual(kept, {
      object: "whatsapp_business_account",
      entries: [{ id: WABA, events: 1, fields: ["messages"], kinds: ["messages:text"] }],
    });
    assert.ok(!JSON.stringify(kept).includes("white"), "no words");
    assert.ok(!JSON.stringify(kept).includes(CUSTOMER), "no numbers");

    const receipt = redactDelivery(
      delivery("messages", { statuses: [{ id: "wamid.1", status: "read", timestamp: "1", recipient_id: CUSTOMER }] })
    );
    assert.deepEqual((receipt.entries as Record<string, unknown>[])[0].kinds, ["status:read"]);
  });

  test("an echo is named as one", () => {
    const echo = redactDelivery(
      delivery("smb_message_echoes", {
        message_echoes: [{ from: "96170708585", to: CUSTOMER, id: "wamid.e", timestamp: "1", type: "text", text: { body: "hello" } }],
      })
    );
    const entry = (echo.entries as Record<string, unknown>[])[0];
    assert.deepEqual(entry.fields, ["smb_message_echoes"]);
    assert.deepEqual(entry.kinds, ["message_echoes:text"]);
  });
});

describe("the 12-month rule", () => {
  test("the cutoff is twelve months before now", () => {
    assert.equal(retentionCutoff(new Date("2026-09-15T01:30:00.000Z")), "2025-09-15T01:30:00.000Z");
  });

  test("only the daily job may run the clean-up", () => {
    const secret = "a-very-long-random-cron-secret";
    assert.equal(isCronAuthorized(`Bearer ${secret}`, secret), true);
    assert.equal(isCronAuthorized(`Bearer wrong-secret-of-some-length`, secret), false);
    assert.equal(isCronAuthorized(null, secret), false);
    assert.equal(isCronAuthorized(`Bearer ${secret}`, null), false, "unset refuses, never opens");
    assert.equal(isCronAuthorized("Bearer short", "short"), false, "a short secret is not a secret");
  });
});
