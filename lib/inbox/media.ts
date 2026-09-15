/**
 * Photos, videos, voice notes and files in the inbox — the small pure helpers
 * the screen and the server share (Samer, 2026-09-15: "send and receive voice
 * notes, photos, videos, PDF files and more … like WhatsApp").
 *
 * PURE and safe to import from the browser.
 */

import type { AttachmentKind, InboxAttachment, InboxMessage } from "@/lib/inbox/types";

/** How a message with no words reads in the conversation list. */
export function mediaLabel(kind: AttachmentKind, filename?: string): string {
  switch (kind) {
    case "image":
      return "📷 Photo";
    case "video":
      return "🎥 Video";
    case "voice":
      return "🎤 Voice message";
    case "audio":
      return "🎵 Audio";
    case "file":
      return filename ? `📄 ${filename}` : "📄 Document";
    case "sticker":
      return "Sticker";
    case "location":
      return "📍 Location";
    case "contact":
      return "👤 Contact";
    case "share":
      return "🔗 Shared post";
  }
}

/**
 * Meta's own picture hosts. Only these are drawn as a picture in the page: a
 * link a customer shares can point anywhere, and loading it would tell that
 * site who is reading the inbox. Anything else is shown as a link to click.
 */
export function isMetaCdn(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /(^|\.)(fbsbx\.com|fbcdn\.net|cdninstagram\.com)$/.test(u.hostname);
  } catch {
    return false;
  }
}

/** The words of a message, or what it carries when it has none. */
export function previewText(m: Pick<InboxMessage, "text" | "attachments">): string {
  if (m.text.trim() !== "") return m.text;
  const a = m.attachments?.[0];
  return a ? mediaLabel(a.kind, a.filename) : "";
}

/**
 * The thread is re-read every few seconds, and every read hands out fresh
 * links. Swapping a photo's link reloads the photo, so a link that still has
 * `minLeftMs` to live is kept. Same message, same position, same kind is the
 * same file: a message's attachments never change.
 */
export function carryUrls(
  prev: readonly InboxMessage[],
  next: readonly InboxMessage[],
  nowMs: number,
  minLeftMs = 10 * 60_000
): InboxMessage[] {
  const before = new Map(prev.map((m) => [m.id, m]));
  return next.map((m) => {
    const old = before.get(m.id);
    if (!old?.attachments || !m.attachments) return m;
    let changed = false;
    const attachments = m.attachments.map((a, i) => {
      const o = old.attachments?.[i];
      if (
        a.state === "ready" &&
        o?.url &&
        o.urlExpiresAt &&
        o.kind === a.kind &&
        Date.parse(o.urlExpiresAt) - nowMs > minLeftMs
      ) {
        changed = true;
        return { ...a, url: o.url, urlExpiresAt: o.urlExpiresAt };
      }
      return a;
    });
    return changed ? { ...m, attachments } : m;
  });
}

/** What the browser's saved copy keeps: everything but the links, which expire. */
export function withoutLinks(messages: readonly InboxMessage[]): InboxMessage[] {
  return messages.map((m) =>
    m.attachments
      ? {
          ...m,
          attachments: m.attachments.map((a): InboxAttachment => {
            const { url: _url, urlExpiresAt: _exp, ...rest } = a;
            return rest;
          }),
        }
      : m
  );
}

export function formatBytes(n: number | undefined): string {
  if (!n || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  const mb = n / (1024 * 1024);
  // "5 MB", "1.5 MB", "16 MB" — never "5.0 MB".
  return `${mb < 10 ? Math.round(mb * 10) / 10 : Math.round(mb)} MB`;
}

/** 7 → "0:07", 75 → "1:15". */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The customer's chat in WhatsApp Web, where the call button is. Calls cannot
 * ring inside MONZA AI on a number shared with the phone app (Meta's Calling
 * API refuses Coexistence numbers), so this is the one-click way to call.
 */
export function waWebChatLink(phone: string | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 ? `https://web.whatsapp.com/send?phone=${digits}` : null;
}

/**
 * A shared Instagram post or reel, as Instagram's own embedded post — the
 * picture or video with its caption, drawn by Instagram inside the chat
 * (Samer, 2026-09-15: "show the post, not a link to it"). Meta's API gives a
 * shared post only as its instagram.com address, with no picture, so the
 * embed is how the post itself appears. Null for anything else.
 */
export function instagramEmbedUrl(link: string | undefined): string | null {
  if (!link) return null;
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !/^(www\.)?instagram\.com$/.test(u.hostname)) return null;
  const m = /^\/(?:[A-Za-z0-9._]{1,30}\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,64})\/?$/.exec(u.pathname);
  if (!m) return null;
  const kind = m[1] === "reels" ? "reel" : m[1];
  return `https://www.instagram.com/${kind}/${m[2]}/embed/captioned/`;
}

const FB_HOST = /^(www\.|m\.|web\.|mbasic\.)?facebook\.com$/;
/** Query parameters a Facebook address needs to name its post; everything else is tracking. */
const FB_KEEP = ["story_fbid", "id", "fbid", "v", "set"];

/**
 * A shared Facebook post, video or reel, as Facebook's own embedded post or
 * video player (Samer, 2026-09-15: shared posts shown "on Facebook and
 * WhatsApp too, not just Instagram"). Public posts only — Facebook shows its
 * own notice for anything else. Null for anything that is not one.
 */
export function facebookEmbedUrl(link: string | undefined): string | null {
  if (!link) return null;
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;

  let kind: "post" | "video" | null = null;
  let clean: string;
  if (u.hostname === "fb.watch") {
    if (!/^\/[A-Za-z0-9_-]{3,40}\/?$/.test(u.pathname)) return null;
    kind = "video";
    clean = `https://fb.watch${u.pathname}`;
  } else if (FB_HOST.test(u.hostname)) {
    const p = u.pathname;
    if (/^\/(reel|reels)\/\d{3,30}\/?$/.test(p) || /^\/watch\/?$/.test(p) || /^\/[A-Za-z0-9.]{1,80}\/videos\/(?:[\w.-]+\/)?\d{3,30}\/?$/.test(p) || /^\/share\/(v|r)\/[A-Za-z0-9_-]{3,40}\/?$/.test(p)) {
      kind = "video";
    } else if (
      /^\/[A-Za-z0-9.]{1,80}\/posts\/[A-Za-z0-9_-]{3,80}\/?$/.test(p) ||
      /^\/(permalink|story|photo)\.php$/.test(p) ||
      /^\/photo\/?$/.test(p) ||
      /^\/[A-Za-z0-9.]{1,80}\/photos\/[\w./-]{3,120}$/.test(p) ||
      /^\/share\/p\/[A-Za-z0-9_-]{3,40}\/?$/.test(p)
    ) {
      kind = "post";
    }
    if (!kind) return null;
    const params = new URLSearchParams();
    for (const k of FB_KEEP) {
      const v = u.searchParams.get(k);
      if (v && /^[A-Za-z0-9._-]{1,80}$/.test(v)) params.set(k, v);
    }
    if (/^\/watch\/?$/.test(p) && !params.get("v")) return null;
    if (/\.php$|^\/photo\/?$/.test(p) && !params.get("story_fbid") && !params.get("fbid")) return null;
    const q = params.toString();
    clean = `https://www.facebook.com${p}${q ? `?${q}` : ""}`;
  } else {
    return null;
  }
  return kind === "video"
    ? `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(clean)}&show_text=false&width=350`
    : `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(clean)}&show_text=true&width=350`;
}

/** How a link in someone's words can be shown as the post itself. */
export interface EmbeddableLink {
  network: "instagram" | "facebook";
  /** The address as written, made https. */
  link: string;
  embed: string;
}

const LINK_IN_TEXT = /(?:https?:\/\/)?(?:(?:www|m|web)\.)?(?:instagram\.com|facebook\.com|fb\.watch)\/[^\s<>"'()]+/gi;

/**
 * The Instagram and Facebook post links inside a message's words — the ones a
 * customer pastes into WhatsApp, mostly — so the chat can show each post under
 * the words, like WhatsApp's own link preview. At most three per message.
 * Any other link stays plain text: MONZA AI never fetches a site a customer
 * names, so a link cannot reach our server or see who reads the inbox.
 */
export function embeddableLinks(text: string | undefined): EmbeddableLink[] {
  if (!text) return [];
  const out: EmbeddableLink[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(LINK_IN_TEXT)) {
    const raw = match[0].replace(/[.,!?;:]+$/, "");
    const link = /^https?:\/\//i.test(raw) ? raw.replace(/^http:/i, "https:") : `https://${raw}`;
    const ig = instagramEmbedUrl(link);
    const fb = ig ? null : facebookEmbedUrl(link);
    const embed = ig ?? fb;
    if (!embed || seen.has(embed)) continue;
    seen.add(embed);
    out.push({ network: ig ? "instagram" : "facebook", link, embed });
    if (out.length === 3) break;
  }
  return out;
}

export function mapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}
