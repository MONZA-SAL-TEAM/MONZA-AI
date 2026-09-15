/**
 * WhatsApp files in the inbox (Samer, 2026-09-15: "send and receive voice
 * notes, photos, videos, PDF files and more"). Pinned here:
 *
 *   - only what WhatsApp accepts can be attached, at WhatsApp's sizes;
 *   - a received file is fetched from Meta with two reads and nothing else,
 *     the key is only ever sent to Meta's own hosts, and a file that does not
 *     match Meta's checksum is not kept;
 *   - a file's type is checked against its first bytes;
 *   - files are kept under paths made from ids, and a browser cannot send a
 *     file uploaded for another conversation;
 *   - a slower writer never turns "stored" back into "pending".
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  checkOutbound,
  classifyFile,
  extFor,
  fetchWhatsAppMedia,
  inboundMediaPath,
  isMetaMediaUrl,
  isOutboundPathFor,
  linksWanted,
  mergeAttachments,
  outboundMediaPath,
  readAttachments,
  safeFilename,
  sha256Matches,
  sniff,
  toInboxAttachment,
  verifiedType,
} from "@/lib/channels/wa-media";
import { carryUrls, formatClock, mediaLabel, previewText, waWebChatLink, withoutLinks } from "@/lib/inbox/media";
import type { InboxMessage } from "@/lib/inbox/types";

const MB = 1024 * 1024;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const PDF = new Uint8Array([...Array.from("%PDF-1.7", (c) => c.charCodeAt(0))]);
const HTML = new Uint8Array(Array.from("<html><script>", (c) => c.charCodeAt(0)));

describe("what can be attached", () => {
  test("WhatsApp's own types and sizes", () => {
    assert.deepEqual(checkOutbound("image", "image/jpeg", 1 * MB), { ok: true, kind: "image", mime: "image/jpeg", ext: "jpg" });
    assert.equal(checkOutbound("audio", "audio/ogg; codecs=opus", 30_000).ok, true);
    assert.equal(checkOutbound("document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 2 * MB).ok, true);
    assert.equal(checkOutbound("video", "video/mp4", 15 * MB).ok, true);

    const big = checkOutbound("image", "image/png", 6 * MB);
    assert.equal(big.ok, false);
    assert.match(!big.ok ? big.problem : "", /5 MB/);
    assert.equal(checkOutbound("image", "image/webp", MB).ok, false, "WhatsApp does not take WebP photos");
    assert.equal(checkOutbound("video", "video/mp4", 17 * MB).ok, false);
    assert.equal(checkOutbound("sticker", "image/webp", 10).ok, false);
    assert.equal(checkOutbound("image", "image/jpeg", 0).ok, false);
  });

  test("a picked file: sent as is, redrawn as a JPG, or refused in words", () => {
    assert.deepEqual(classifyFile({ name: "car.jpg", type: "image/jpeg", size: MB }), { ok: true, kind: "image", mime: "image/jpeg", convert: false });
    assert.deepEqual(classifyFile({ name: "car.webp", type: "image/webp", size: MB }), { ok: true, kind: "image", mime: "image/jpeg", convert: true });
    assert.equal((classifyFile({ name: "big.jpg", type: "image/jpeg", size: 7 * MB }) as { convert: boolean }).convert, true);
    assert.deepEqual(classifyFile({ name: "offer.docx", type: "", size: MB }), {
      ok: true,
      kind: "document",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      convert: false,
    });
    const mov = classifyFile({ name: "clip.mov", type: "video/quicktime", size: MB });
    assert.match(!mov.ok ? mov.problem : "", /MP4/);
    assert.equal(classifyFile({ name: "setup.exe", type: "application/x-msdownload", size: MB }).ok, false);
    assert.equal(classifyFile({ name: "x.zip", type: "application/zip", size: MB }).ok, false);
  });

  test("a document keeps a clean name with its extension", () => {
    assert.equal(safeFilename("Offer VOYAH Free.pdf", "pdf"), "Offer VOYAH Free.pdf");
    assert.equal(safeFilename("C:\\Users\\x\\price list", "pdf"), "price list.pdf");
    assert.equal(safeFilename("../../etc/passwd", "txt"), "passwd.txt");
    assert.equal(safeFilename("", "pdf"), "Monza.pdf");
    assert.equal(safeFilename(undefined, "jpg"), "Monza.jpg");
  });
});

describe("a file is what it says it is", () => {
  test("first bytes decide", () => {
    assert.equal(sniff(JPEG), "jpeg");
    assert.equal(sniff(PDF), "pdf");
    assert.equal(sniff(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70])), "isobmff");
    assert.equal(sniff(new Uint8Array(Array.from("OggS", (c) => c.charCodeAt(0)))), "ogg");
    assert.equal(sniff(HTML), null);
  });

  test("a 'photo' that is really a web page is kept as a plain download", () => {
    assert.equal(verifiedType("image/jpeg", JPEG), "image/jpeg");
    assert.equal(verifiedType("image/jpeg", HTML), "application/octet-stream");
    assert.equal(verifiedType("application/pdf", PDF), "application/pdf");
    assert.equal(verifiedType("text/plain", HTML), "text/plain", "text is text, and only ever downloaded");
    assert.equal(verifiedType("application/zip", PDF), "application/octet-stream", "unknown types are downloads");
  });

  test("Meta's checksum, in hex or base64", async () => {
    const hex = createHash("sha256").update(JPEG).digest("hex");
    const b64 = createHash("sha256").update(JPEG).digest("base64");
    assert.equal(await sha256Matches(JPEG, hex), true);
    assert.equal(await sha256Matches(JPEG, b64), true);
    assert.equal(await sha256Matches(JPEG, hex.toUpperCase()), true);
    assert.equal(await sha256Matches(PDF, hex), false);
  });
});

describe("where files are kept", () => {
  const ACC = "wa-monza";
  const CONV = "0b7e4b8e-4a4e-4b3e-9c1f-2d8f7a6c5e41";

  test("a received file's place is made from ids — a redelivery lands on the same one", () => {
    const a = inboundMediaPath(ACC, CONV, "wamid.HBgL+/=abc", 0, "jpg");
    assert.equal(a, inboundMediaPath(ACC, CONV, "wamid.HBgL+/=abc", 0, "jpg"));
    assert.match(a, /^in\/wa-monza\/0b7e4b8e-4a4e-4b3e-9c1f-2d8f7a6c5e41\/wamid\.HBgL___abc-0\.jpg$/);
  });

  test("a file uploaded for one conversation cannot be sent in another", () => {
    const p = outboundMediaPath(ACC, CONV, "5f0c3a1e-1111-4222-8333-944455556666", "pdf");
    assert.equal(isOutboundPathFor(p, ACC, CONV), true);
    assert.equal(isOutboundPathFor(p, ACC, "11111111-2222-4333-8444-555555555555"), false);
    assert.equal(isOutboundPathFor(p, "wa-other", CONV), false);
    assert.equal(isOutboundPathFor(`out/${ACC}/${CONV}/../x.pdf`, ACC, CONV), false);
    assert.equal(isOutboundPathFor(inboundMediaPath(ACC, CONV, "wamid.1", 0, "jpg"), ACC, CONV), false, "a customer's file is not ours to send");
    assert.equal(isOutboundPathFor(42, ACC, CONV), false);
  });

  test("the extension comes from the checked type, then the name", () => {
    assert.equal(extFor("image/jpeg"), "jpg");
    assert.equal(extFor("audio/ogg; codecs=opus"), "ogg");
    assert.equal(extFor("application/octet-stream", "notes.rtf"), "rtf");
    assert.equal(extFor("application/octet-stream", "weird.n@me"), "bin");
  });
});

describe("fetching a received file from Meta", () => {
  type Call = { url: string; auth: string | null };
  const INFO_URL = "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=123";

  function fakeMeta(info: { status?: number; body: unknown }, file?: { status?: number; bytes?: Uint8Array }, calls: Call[] = []) {
    return (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, auth: new Headers(init?.headers).get("authorization") });
      if (u.startsWith("https://graph.facebook.com/")) {
        return new Response(JSON.stringify(info.body), { status: info.status ?? 200 });
      }
      const bytes = file?.bytes ?? JPEG;
      return new Response(new Uint8Array(bytes), { status: file?.status ?? 200 });
    }) as typeof fetch;
  }

  const hex = createHash("sha256").update(JPEG).digest("hex");
  const INPUT = { mediaId: "1234567890123", phoneNumberId: "984244264767607" };

  test("two reads: where it is, then the file — with the number's id, and nothing else", async () => {
    const calls: Call[] = [];
    const r = await fetchWhatsAppMedia(
      INPUT,
      "KEY",
      fakeMeta({ body: { url: INFO_URL, mime_type: "image/jpeg", sha256: hex, file_size: JPEG.length } }, undefined, calls)
    );
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.mime, "image/jpeg");
    assert.deepEqual(r.ok && Array.from(r.bytes), Array.from(JPEG));
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "https://graph.facebook.com/v21.0/1234567890123?phone_number_id=984244264767607");
    assert.equal(calls[1].url, INFO_URL);
    assert.ok(calls.every((c) => c.auth === "Bearer KEY"));
    assert.ok(calls.every((c) => !/register|deregister|request_code|verify_code|settings/.test(c.url)));
  });

  test("the key is never sent anywhere but Meta's own file hosts", async () => {
    const calls: Call[] = [];
    const r = await fetchWhatsAppMedia(INPUT, "KEY", fakeMeta({ body: { url: "https://evil.example.com/x" } }, undefined, calls));
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.state, "failed");
    assert.equal(calls.length, 1, "no second request");
    assert.equal(isMetaMediaUrl("https://lookaside.fbsbx.com/a"), true);
    assert.equal(isMetaMediaUrl("http://lookaside.fbsbx.com/a"), false);
    assert.equal(isMetaMediaUrl("https://fbsbx.com.evil.io/a"), false);
  });

  test("gone, too large, broken and a hiccup are told apart", async () => {
    const gone = await fetchWhatsAppMedia(INPUT, "K", fakeMeta({ status: 404, body: { error: { code: 100 } } }));
    assert.equal(!gone.ok && gone.state, "unavailable");

    const calls: Call[] = [];
    const big = await fetchWhatsAppMedia(INPUT, "K", fakeMeta({ body: { url: INFO_URL, file_size: 200 * MB } }, undefined, calls));
    assert.equal(!big.ok && big.state, "too_large");
    assert.equal(calls.length, 1, "a file too large to keep is not downloaded");

    const bad = await fetchWhatsAppMedia(INPUT, "K", fakeMeta({ body: { url: INFO_URL, sha256: hex } }, { bytes: PDF }));
    assert.equal(!bad.ok && bad.state, "failed", "a file that does not match Meta's checksum is not kept");

    const hiccup = await fetchWhatsAppMedia(INPUT, "K", fakeMeta({ status: 500, body: {} }));
    assert.equal(!hiccup.ok && hiccup.state, "retry");

    const offline = await fetchWhatsAppMedia(INPUT, "K", (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch);
    assert.equal(!offline.ok && offline.state, "retry");
  });

  test("an id that is not digits is refused before any request", async () => {
    const calls: Call[] = [];
    const r = await fetchWhatsAppMedia({ mediaId: "../me", phoneNumberId: "984244264767607" }, "K", fakeMeta({ body: {} }, undefined, calls));
    assert.equal(r.ok, false);
    assert.equal(calls.length, 0);
  });

  test("a file claiming to be a photo but not one is kept as a download", async () => {
    const r = await fetchWhatsAppMedia(INPUT, "K", fakeMeta({ body: { url: INFO_URL, mime_type: "image/jpeg" } }, { bytes: HTML }));
    assert.equal(r.ok && r.mime, "application/octet-stream");
  });
});

describe("what is stored, and what the screen shows", () => {
  test("a slower writer never turns 'stored' back into 'pending'", () => {
    const stored = { kind: "image" as const, state: "stored" as const, path: "in/a/b/c-0.jpg" };
    const pending = { kind: "image" as const, state: "pending" as const, mediaId: "1" };
    assert.deepEqual(mergeAttachments([stored], [pending]), [stored]);
    assert.deepEqual(mergeAttachments([pending], [stored]), [stored]);
    assert.deepEqual(
      mergeAttachments([pending, stored], [{ ...pending, state: "unavailable" }, pending]),
      [{ ...pending, state: "unavailable" }, stored]
    );
  });

  test("the column is read defensively", () => {
    assert.deepEqual(readAttachments(null), []);
    assert.deepEqual(readAttachments([{ kind: "image" }, { kind: "bogus" }, "x", { kind: "audio", voice: "yes", size: "3" }]), [
      { kind: "image" },
      { kind: "audio" },
    ]);
  });

  test("each state reads as the screen needs it", () => {
    const link = { url: "https://x/sig", expiresAt: "2026-09-15T12:00:00.000Z" };
    assert.deepEqual(toInboxAttachment({ kind: "image", state: "stored", path: "p", mime: "image/jpeg" }, link), {
      kind: "image",
      state: "ready",
      mime: "image/jpeg",
      url: "https://x/sig",
      urlExpiresAt: link.expiresAt,
    });
    assert.equal(toInboxAttachment({ kind: "audio", voice: true, state: "pending" })?.kind, "voice");
    assert.equal(toInboxAttachment({ kind: "audio", state: "pending" })?.kind, "audio");
    assert.equal(toInboxAttachment({ kind: "image" })?.state, "unavailable", "from before files were kept");
    assert.equal(toInboxAttachment({ kind: "video", state: "too_large" })?.state, "too_large");
    assert.equal(toInboxAttachment({ kind: "location", lat: 33.9, lng: 35.5 })?.state, "ready");
    assert.equal(toInboxAttachment({ kind: "story" }), null);
  });

  test("documents download under their own name; photos open in the page", () => {
    assert.deepEqual(
      linksWanted([
        { kind: "image", state: "stored", path: "a.jpg", mime: "image/jpeg" },
        { kind: "file", state: "stored", path: "b.pdf", mime: "application/pdf", filename: "Offer.pdf" },
        { kind: "image", state: "stored", path: "c.bin", mime: "application/octet-stream" },
        { kind: "image", state: "pending" },
      ]),
      [{ path: "a.jpg" }, { path: "b.pdf", download: "Offer.pdf" }, { path: "c.bin", download: "file" }]
    );
  });
});

describe("the inbox's side", () => {
  const msg = (over: Partial<InboxMessage>): InboxMessage => ({
    id: "m1",
    conversationId: "t",
    direction: "in",
    author: "customer",
    text: "",
    at: "2026-09-15T10:00:00.000Z",
    status: "received",
    ...over,
  });

  test("a message with no words reads as what it carries", () => {
    assert.equal(previewText(msg({ attachments: [{ kind: "voice", state: "ready" }] })), "🎤 Voice message");
    assert.equal(previewText(msg({ attachments: [{ kind: "file", state: "ready", filename: "Offer.pdf" }] })), "📄 Offer.pdf");
    assert.equal(previewText(msg({ text: "my car", attachments: [{ kind: "image", state: "ready" }] })), "my car");
    assert.equal(mediaLabel("image"), "📷 Photo");
  });

  test("a photo keeps its link while it is fresh, so it does not reload every few seconds", () => {
    const now = Date.parse("2026-09-15T10:00:00.000Z");
    const old = msg({ attachments: [{ kind: "image", state: "ready", url: "OLD", urlExpiresAt: "2026-09-15T10:50:00.000Z" }] });
    const fresh = msg({ attachments: [{ kind: "image", state: "ready", url: "NEW", urlExpiresAt: "2026-09-15T11:00:00.000Z" }] });
    assert.equal(carryUrls([old], [fresh], now)[0].attachments?.[0].url, "OLD");
    assert.equal(carryUrls([old], [fresh], Date.parse("2026-09-15T10:45:00.000Z"))[0].attachments?.[0].url, "NEW", "…but not in its last minutes");
    assert.equal(carryUrls([], [fresh], now)[0].attachments?.[0].url, "NEW");
  });

  test("the browser's saved copy never keeps a link", () => {
    const [m] = withoutLinks([msg({ attachments: [{ kind: "image", state: "ready", url: "U", urlExpiresAt: "T" }] })]);
    assert.deepEqual(m.attachments, [{ kind: "image", state: "ready" }]);
  });

  test("calling: the customer's chat in WhatsApp Web, from the stored number", () => {
    assert.equal(waWebChatLink("+961 70 123 456"), "https://web.whatsapp.com/send?phone=96170123456");
    assert.equal(waWebChatLink(""), null);
    assert.equal(waWebChatLink(undefined), null);
  });

  test("voice note times", () => {
    assert.equal(formatClock(7), "0:07");
    assert.equal(formatClock(75.9), "1:15");
    assert.equal(formatClock(Number.NaN), "0:00");
  });
});
