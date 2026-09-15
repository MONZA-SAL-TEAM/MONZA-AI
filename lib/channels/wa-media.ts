/**
 * WHATSAPP FILES — photos, videos, voice notes, documents (Samer, 2026-09-15:
 * "send and receive voice notes, photos, videos, PDF files and more").
 *
 * The rules in one place, shared by the browser (what may be attached) and the
 * server (what is fetched, kept and sent):
 *
 *   RECEIVING  A file a customer sends arrives as a media ID. Meta keeps it for
 *              7 DAYS, and each download link it gives out works for 5
 *              minutes, so the file is copied into our private bucket
 *              (`whatsapp-media`, migration 010) when it arrives. Copied files
 *              are deleted with their messages after 12 months.
 *   SENDING    Only what WhatsApp itself accepts, at WhatsApp's sizes (Meta's
 *              media reference). The browser checks first so nobody waits for
 *              an upload WhatsApp would refuse; the server checks again because
 *              the browser is not trusted.
 *
 * A file from a customer is UNTRUSTED. It is kept under a path WE choose, its
 * type is checked against its first bytes (a "photo" that is not one is kept
 * as a plain download), and nothing but photos, videos and audio is ever shown
 * inline.
 *
 * PURE apart from fetchWhatsAppMedia, whose network is a parameter. Safe to
 * import from the browser.
 */

import type { AttachmentKind, InboxAttachment } from "@/lib/inbox/types";
import { formatBytes } from "@/lib/inbox/media";

export const WA_MEDIA_BUCKET = "whatsapp-media";
/** MUST match the bucket's file_size_limit (migration 010). Meta's own ceiling (documents). */
export const WA_MEDIA_MAX_BYTES = 100 * 1024 * 1024;
/** Meta keeps a received file for 7 days; after that it is gone for good. */
export const META_MEDIA_DAYS = 7;
/** How long a link handed to the inbox works. */
export const SIGNED_URL_SECONDS = 60 * 60;
/** WhatsApp's limit for the words under a photo, video or document. */
export const MAX_CAPTION = 1024;

const GRAPH = "https://graph.facebook.com/v21.0";
const DIGITS = /^\d{5,30}$/;
const MB = 1024 * 1024;

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/* ── What is stored, per attachment, in channel_messages.attachments ─────── */

/**
 *   pending      arrived; not copied yet
 *   stored       copied into the bucket at `path`
 *   too_large    over the bucket's limit — it is on the phone
 *   unavailable  Meta no longer has it (7 days), or it predates this feature
 *   failed       the download did not match Meta's checksum, or was refused
 */
export type MediaState = "pending" | "stored" | "too_large" | "unavailable" | "failed";

export type StoredKind =
  | "image"
  | "video"
  | "audio"
  | "file"
  | "sticker"
  | "location"
  | "contact"
  | "story"
  | "unknown";

export interface StoredAttachment {
  kind: StoredKind;
  mediaId?: string;
  mime?: string;
  sha256?: string;
  filename?: string;
  size?: number;
  voice?: boolean;
  path?: string;
  state?: MediaState;
  lat?: number;
  lng?: number;
  label?: string;
  name?: string;
  phone?: string;
}

const STORED_KINDS: ReadonlySet<string> = new Set([
  "image",
  "video",
  "audio",
  "file",
  "sticker",
  "location",
  "contact",
  "story",
  "unknown",
]);
const MEDIA_KINDS: ReadonlySet<string> = new Set(["image", "video", "audio", "file", "sticker"]);
const STATES: ReadonlySet<string> = new Set(["pending", "stored", "too_large", "unavailable", "failed"]);

export function isMediaKind(kind: string): boolean {
  return MEDIA_KINDS.has(kind);
}

/** The jsonb column, read defensively: it holds whatever any past version wrote. */
export function readAttachments(value: unknown): StoredAttachment[] {
  if (!Array.isArray(value)) return [];
  const out: StoredAttachment[] = [];
  for (const v of value) {
    const o = obj(v);
    const kind = str(o?.kind);
    if (!o || !kind || !STORED_KINDS.has(kind)) continue;
    const a: StoredAttachment = { kind: kind as StoredKind };
    const text = (k: "mediaId" | "mime" | "sha256" | "filename" | "path" | "label" | "name" | "phone") => {
      const s = str(o[k]);
      if (s) a[k] = s;
    };
    text("mediaId");
    text("mime");
    text("sha256");
    text("filename");
    text("path");
    text("label");
    text("name");
    text("phone");
    const size = num(o.size);
    if (size !== undefined) a.size = size;
    const lat = num(o.lat);
    const lng = num(o.lng);
    if (lat !== undefined && lng !== undefined) {
      a.lat = lat;
      a.lng = lng;
    }
    if (o.voice === true) a.voice = true;
    const state = str(o.state);
    if (state && STATES.has(state)) a.state = state as MediaState;
    out.push(a);
  }
  return out;
}

/** Rank of a state: the copy that got further wins when two writers race. */
function rank(a: StoredAttachment | undefined): number {
  switch (a?.state) {
    case "stored":
      return 3;
    case "too_large":
    case "unavailable":
    case "failed":
      return 2;
    case "pending":
      return 1;
    default:
      return 0;
  }
}

/**
 * Two copies of one message's attachments — what the database holds now and
 * what this process just produced — merged position by position so that a
 * slower writer holding an older snapshot can never turn "stored" back into
 * "pending".
 */
export function mergeAttachments(
  current: readonly StoredAttachment[],
  mine: readonly StoredAttachment[]
): StoredAttachment[] {
  const n = Math.max(current.length, mine.length);
  const out: StoredAttachment[] = [];
  for (let i = 0; i < n; i++) {
    const c = current[i];
    const m = mine[i];
    if (!c) out.push(m as StoredAttachment);
    else if (!m) out.push(c);
    else out.push(rank(m) >= rank(c) ? m : c);
  }
  return out;
}

/** Stored → what the screen shows. `link` is the signed URL for a stored file. */
export function toInboxAttachment(
  a: StoredAttachment,
  link?: { url: string; expiresAt: string }
): InboxAttachment | null {
  let kind: AttachmentKind;
  switch (a.kind) {
    case "audio":
      kind = a.voice ? "voice" : "audio";
      break;
    case "image":
    case "video":
    case "file":
    case "sticker":
    case "location":
    case "contact":
      kind = a.kind;
      break;
    default:
      return null; // a story reply or an unknown kind: nothing to show
  }

  const base: InboxAttachment = { kind, state: "ready" };
  if (a.mime) base.mime = a.mime;
  if (a.filename) base.filename = a.filename;
  if (a.size !== undefined) base.size = a.size;
  if (a.lat !== undefined && a.lng !== undefined) {
    base.lat = a.lat;
    base.lng = a.lng;
  }
  if (a.label) base.label = a.label;
  if (a.name) base.name = a.name;
  if (a.phone) base.phone = a.phone;

  if (kind === "location" || kind === "contact") return base;
  switch (a.state) {
    case "stored":
      return link ? { ...base, url: link.url, urlExpiresAt: link.expiresAt } : base;
    case "pending":
      return { ...base, state: "pending" };
    case "too_large":
      return { ...base, state: "too_large" };
    default:
      // unavailable, failed, and rows from before files were kept (no state).
      return { ...base, state: "unavailable" };
  }
}

/** Whether a stored file is only ever downloaded, never shown in the page. */
export function downloadOnly(a: StoredAttachment): boolean {
  return a.kind === "file" || !a.mime || a.mime === "application/octet-stream";
}

/** The files a thread needs links for, each with how it should open. */
export function linksWanted(attachments: readonly StoredAttachment[]): { path: string; download?: string }[] {
  const out: { path: string; download?: string }[] = [];
  for (const a of attachments) {
    if (a.state !== "stored" || !a.path) continue;
    out.push(downloadOnly(a) ? { path: a.path, download: a.filename ?? "file" } : { path: a.path });
  }
  return out;
}

/* ── Types ───────────────────────────────────────────────────────────────── */

const ALIASES: Readonly<Record<string, string>> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "audio/x-m4a": "audio/mp4",
  "audio/m4a": "audio/mp4",
  "audio/mp3": "audio/mpeg",
  "audio/x-aac": "audio/aac",
  "audio/opus": "audio/ogg",
  "application/x-pdf": "application/pdf",
};

/** "audio/ogg; codecs=opus" → "audio/ogg"; common aliases folded. */
export function baseMime(mime: string): string {
  const m = mime.split(";")[0].trim().toLowerCase();
  return ALIASES[m] ?? m;
}

const DOC_TYPES: Readonly<Record<string, string>> = {
  "application/pdf": "pdf",
  "text/plain": "txt",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

const AUDIO_TYPES: Readonly<Record<string, string>> = {
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
};

/** What each kind of attachment may be, per WhatsApp (Meta's media reference). */
export type OutboundKind = "image" | "video" | "audio" | "document";

export const OUTBOUND: Readonly<
  Record<OutboundKind, { types: Readonly<Record<string, string>>; maxBytes: number; words: string }>
> = {
  image: { types: { "image/jpeg": "jpg", "image/png": "png" }, maxBytes: 5 * MB, words: "JPG or PNG photos up to 5 MB" },
  video: { types: { "video/mp4": "mp4", "video/3gpp": "3gp" }, maxBytes: 16 * MB, words: "MP4 videos up to 16 MB" },
  audio: { types: AUDIO_TYPES, maxBytes: 16 * MB, words: "MP3, M4A, AAC, AMR or OGG audio up to 16 MB" },
  document: {
    types: DOC_TYPES,
    maxBytes: 100 * MB,
    words: "PDF, Word, Excel, PowerPoint or text files up to 100 MB",
  },
};

export function isOutboundKind(kind: unknown): kind is OutboundKind {
  return kind === "image" || kind === "video" || kind === "audio" || kind === "document";
}

/** One attachment about to be sent, checked against WhatsApp's own rules. */
export function checkOutbound(
  kind: unknown,
  mime: unknown,
  size: unknown
): { ok: true; kind: OutboundKind; mime: string; ext: string } | { ok: false; problem: string } {
  if (!isOutboundKind(kind)) return { ok: false, problem: "That kind of attachment cannot be sent." };
  const rule = OUTBOUND[kind];
  const m = typeof mime === "string" ? baseMime(mime) : "";
  const ext = rule.types[m];
  if (!ext) return { ok: false, problem: `WhatsApp only accepts ${rule.words} here.` };
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
    return { ok: false, problem: "That file is empty." };
  }
  if (size > rule.maxBytes) {
    return {
      ok: false,
      problem: `That file is ${formatBytes(size)}; WhatsApp allows ${formatBytes(rule.maxBytes)} for this kind.`,
    };
  }
  return { ok: true, kind, mime: m, ext };
}

const EXT_TYPES: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  mp4: "video/mp4",
  "3gp": "video/3gpp",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  amr: "audio/amr",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  pdf: "application/pdf",
  txt: "text/plain",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

function extOf(filename: string): string {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(filename);
  return m ? m[1].toLowerCase() : "";
}

/** Browsers leave `type` empty for some files (.docx on Windows, often): the name decides. */
export function mimeFromFilename(filename: string): string | null {
  return EXT_TYPES[extOf(filename)] ?? null;
}

/** Photos the browser can redraw as a JPG before sending (a photo over 5 MB, a WebP…). */
const CONVERTIBLE_IMAGES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/avif",
  "image/heic",
  "image/heif",
]);

/** The largest photo worth trying to shrink in the browser. */
export const MAX_IMAGE_INPUT_BYTES = 40 * MB;

/**
 * What a file someone picked should be sent as, before anything is uploaded.
 * `convert` means the browser redraws it as a JPG first (lib/inbox/send-media.ts).
 */
export function classifyFile(file: {
  name: string;
  type: string;
  size: number;
}): { ok: true; kind: OutboundKind; mime: string; convert: boolean } | { ok: false; problem: string } {
  const mime = (file.type ? baseMime(file.type) : "") || mimeFromFilename(file.name) || "";
  if (file.size <= 0) return { ok: false, problem: "That file is empty." };

  if (mime.startsWith("image/")) {
    if (!CONVERTIBLE_IMAGES.has(mime)) return { ok: false, problem: "WhatsApp cannot send that kind of image." };
    if (file.size > MAX_IMAGE_INPUT_BYTES) {
      return { ok: false, problem: `That photo is ${formatBytes(file.size)} — too large to send.` };
    }
    const asIs = OUTBOUND.image.types[mime] !== undefined && file.size <= OUTBOUND.image.maxBytes;
    return { ok: true, kind: "image", mime: asIs ? mime : "image/jpeg", convert: !asIs };
  }
  if (mime === "video/quicktime") {
    return { ok: false, problem: "iPhone .MOV videos cannot be sent — WhatsApp needs an MP4 video up to 16 MB." };
  }
  const kind: OutboundKind | null = mime.startsWith("video/")
    ? "video"
    : mime.startsWith("audio/")
      ? "audio"
      : DOC_TYPES[mime]
        ? "document"
        : null;
  if (!kind) {
    return {
      ok: false,
      problem: "WhatsApp cannot send that kind of file. Photos, MP4 videos, audio, PDF, Word, Excel, PowerPoint and text files can be sent.",
    };
  }
  const check = checkOutbound(kind, mime, file.size);
  return check.ok ? { ok: true, kind, mime: check.mime, convert: false } : check;
}

/* ── Checking a file is what it says ─────────────────────────────────────── */

type Family = "jpeg" | "png" | "webp" | "gif" | "ogg" | "isobmff" | "mp3" | "amr" | "aac" | "pdf" | "zip" | "ole";

function at(b: Uint8Array, offset: number, text: string): boolean {
  if (b.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i++) if (b[offset + i] !== text.charCodeAt(i)) return false;
  return true;
}

/** What a file's first bytes say it is. */
export function sniff(b: Uint8Array): Family | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 4 && b[0] === 0x89 && at(b, 1, "PNG")) return "png";
  if (at(b, 0, "RIFF") && at(b, 8, "WEBP")) return "webp";
  if (at(b, 0, "GIF8")) return "gif";
  if (at(b, 0, "OggS")) return "ogg";
  if (at(b, 4, "ftyp")) return "isobmff";
  if (at(b, 0, "#!AMR")) return "amr";
  if (at(b, 0, "%PDF")) return "pdf";
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return "zip";
  if (b.length >= 4 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return "ole";
  if (at(b, 0, "ID3")) return "mp3";
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return "aac"; // ADTS
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return "mp3"; // MPEG audio frame
  return null;
}

const EXPECT: Readonly<Record<string, readonly Family[] | "any">> = {
  "image/jpeg": ["jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "video/mp4": ["isobmff"],
  "video/3gpp": ["isobmff"],
  "audio/mp4": ["isobmff"],
  "audio/aac": ["aac", "isobmff"],
  "audio/ogg": ["ogg"],
  "audio/mpeg": ["mp3"],
  "audio/amr": ["amr"],
  "application/pdf": ["pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["zip"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["zip"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["zip"],
  "application/msword": ["ole"],
  "application/vnd.ms-excel": ["ole"],
  "application/vnd.ms-powerpoint": ["ole"],
  "text/plain": "any",
};

/**
 * The type a file is kept and served as: what it claims, when its first bytes
 * agree — otherwise a plain download (`application/octet-stream`), which the
 * inbox never renders. A "photo" that is really a web page stays a download.
 */
export function verifiedType(claimed: string, bytes: Uint8Array): string {
  const m = baseMime(claimed);
  const expected = EXPECT[m];
  if (!expected) return "application/octet-stream";
  if (expected === "any") return m;
  const family = sniff(bytes);
  return family && expected.includes(family) ? m : "application/octet-stream";
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** Meta's checksum of a file, compared with what was downloaded. Hex or base64. */
export async function sha256Matches(bytes: Uint8Array, expected: string): Promise<boolean> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  const b64 = base64(digest).replace(/=+$/, "");
  const e = expected.trim().replace(/=+$/, "");
  return e.toLowerCase() === hex || e === b64 || e === b64.replace(/\+/g, "-").replace(/\//g, "_");
}

/* ── Where files are kept ────────────────────────────────────────────────── */

function segment(s: string, max: number): string {
  return s.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, max) || "x";
}

const STORED_EXT: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  ...AUDIO_TYPES,
  ...DOC_TYPES,
};

/** The file extension a kept file gets: from its verified type, else its name. */
export function extFor(mime: string, filename?: string): string {
  const known = STORED_EXT[baseMime(mime)];
  if (known) return known;
  const fromName = filename ? extOf(filename) : "";
  return /^[a-z0-9]{1,5}$/.test(fromName) ? fromName : "bin";
}

/**
 * Where a received file is kept. Made from ids only, and the same for a
 * redelivered message — so Meta sending it twice keeps it once (rule 17).
 */
export function inboundMediaPath(
  accountId: string,
  conversationId: string,
  externalMessageId: string,
  index: number,
  ext: string
): string {
  return `in/${segment(accountId, 40)}/${segment(conversationId, 40)}/${segment(externalMessageId, 120)}-${index}.${segment(ext, 5)}`;
}

/** Where a file staff attach is uploaded — chosen by the server, never the browser. */
export function outboundMediaPath(accountId: string, conversationId: string, fileId: string, ext: string): string {
  return `out/${segment(accountId, 40)}/${segment(conversationId, 40)}/${segment(fileId, 40)}.${segment(ext, 5)}`;
}

/**
 * Whether `path` is a file uploaded for THIS conversation. The send route
 * checks it, so a browser cannot send one customer's file — or anything else
 * in the bucket — to another.
 */
export function isOutboundPathFor(path: unknown, accountId: string, conversationId: string): path is string {
  if (typeof path !== "string" || path.length > 300) return false;
  const prefix = `out/${segment(accountId, 40)}/${segment(conversationId, 40)}/`;
  if (!path.startsWith(prefix)) return false;
  return /^[A-Za-z0-9_-]{1,40}\.[a-z0-9]{2,5}$/.test(path.slice(prefix.length));
}

/**
 * The name a document goes out under: no folders, no control characters, a
 * sensible length, and the extension WhatsApp picks its icon from.
 */
export function safeFilename(name: unknown, ext: string): string {
  const raw = typeof name === "string" ? name : "";
  const base = raw
    .split(/[\\/]/)
    .pop()!
    .replace(/[ -<>:"|?*]/g, "")
    .trim()
    .slice(0, 120);
  if (base === "" || base === "." || base === "..") return `Monza.${ext}`;
  return extOf(base) === ext ? base : `${base.replace(/\.+$/, "")}.${ext}`;
}

/* ── Fetching a received file from Meta ──────────────────────────────────── */

/** Meta's own file hosts. Our key is only ever sent to one of these. */
export function isMetaMediaUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /(^|\.)(fbsbx\.com|fbcdn\.net|facebook\.com|whatsapp\.net)$/.test(u.hostname);
  } catch {
    return false;
  }
}

/**
 *   unavailable  Meta no longer has it — final
 *   too_large    over our limit — final
 *   failed       it did not match Meta's checksum, or Meta pointed elsewhere — final
 *   retry        a network or server hiccup — try again later
 */
export type MediaFetch =
  | { ok: true; bytes: Uint8Array; mime: string }
  | { ok: false; state: "unavailable" | "too_large" | "failed" | "retry"; problem: string };

/**
 * Download one received file: ask Meta where it is (GET /{media-id}), then
 * fetch it from there with the same key. Two reads, nothing else — no call
 * here can touch the number or its registration.
 */
export async function fetchWhatsAppMedia(
  input: { mediaId: string; phoneNumberId: string; sha256?: string; mime?: string },
  token: string,
  fetchFn: typeof fetch = fetch,
  maxBytes = WA_MEDIA_MAX_BYTES
): Promise<MediaFetch> {
  if (!DIGITS.test(input.mediaId) || !DIGITS.test(input.phoneNumberId)) {
    return { ok: false, state: "failed", problem: "Not a WhatsApp file id." };
  }

  let info: Record<string, unknown>;
  try {
    const res = await fetchFn(`${GRAPH}/${input.mediaId}?phone_number_id=${input.phoneNumberId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    const json = obj(await res.json().catch(() => null));
    if (!res.ok) {
      const code = num(obj(json?.error)?.code);
      if (res.status === 404 || code === 100) {
        return { ok: false, state: "unavailable", problem: "WhatsApp no longer has this file." };
      }
      return { ok: false, state: "retry", problem: `WhatsApp answered HTTP ${res.status}.` };
    }
    if (!json) return { ok: false, state: "retry", problem: "WhatsApp's answer was not readable." };
    info = json;
  } catch {
    return { ok: false, state: "retry", problem: "Could not reach WhatsApp." };
  }

  const url = str(info.url);
  if (!url || !isMetaMediaUrl(url)) return { ok: false, state: "failed", problem: "WhatsApp gave no usable link." };
  const declared = num(info.file_size);
  if (declared !== undefined && declared > maxBytes) {
    return { ok: false, state: "too_large", problem: `The file is ${formatBytes(declared)}.` };
  }

  let bytes: Uint8Array;
  try {
    const res = await fetchFn(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      return res.status === 404
        ? { ok: false, state: "unavailable", problem: "WhatsApp no longer has this file." }
        : { ok: false, state: "retry", problem: `The download answered HTTP ${res.status}.` };
    }
    const length = Number(res.headers.get("content-length"));
    if (Number.isFinite(length) && length > maxBytes) {
      return { ok: false, state: "too_large", problem: `The file is ${formatBytes(length)}.` };
    }
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    return { ok: false, state: "retry", problem: "The download did not finish." };
  }
  if (bytes.length === 0) return { ok: false, state: "retry", problem: "The download was empty." };
  if (bytes.length > maxBytes) return { ok: false, state: "too_large", problem: `The file is ${formatBytes(bytes.length)}.` };

  const expected = str(info.sha256) ?? input.sha256;
  if (expected && !(await sha256Matches(bytes, expected))) {
    return { ok: false, state: "failed", problem: "The download did not match WhatsApp's checksum." };
  }

  return { ok: true, bytes, mime: verifiedType(str(info.mime_type) ?? input.mime ?? "", bytes) };
}
