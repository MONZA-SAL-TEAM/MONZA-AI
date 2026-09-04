/**
 * The media library's path and file rules — ONE definition, shared by the
 * browser store (lib/wasales/media-store.ts) and the server route
 * (app/api/wasales-media/route.ts).
 *
 * They used to be two copies that had already drifted (the route accepted a
 * narrower car id than the store could produce). Path validation is a security
 * boundary; a security boundary with two definitions has one too many.
 *
 * Pure and deterministic: no I/O, no Date, no randomness. Everything here is
 * directly testable.
 *
 * Object path scheme:   <carId>/<video|brochure>/<objectName>
 *   carId       1–64 of [A-Za-z0-9_-]   — no dots and no slashes, so neither
 *                                          "." nor ".." can ever be a segment
 *   objectName  1–200 of [A-Za-z0-9_.-] — no slashes; may not start with a dot
 *                                          and may not be dots only
 *
 * The stored object name is "<uuid>__<safeOriginalName>"; the name shown to
 * people is the part after the first "__".
 */

export const MEDIA_BUCKET = "wasales-media";

export type MediaKindName = "video" | "brochure";

/**
 * The shared bucket's per-file ceiling. MUST match the bucket's own
 * `file_size_limit`, or the browser refuses a file the bucket would have
 * accepted (or worse, accepts one it then rejects mid-upload).
 *
 * Raised from 50 MiB on 4 September 2026: three real files were over it —
 * Courage White (115.5 MB), the Voyah Passion catalogue (68.3 MB) and Free
 * Comp Green (62.6 MB).
 */
export const STORAGE_MAX_BYTES = 200 * 1024 * 1024;

/** The bucket's MIME allowlist. */
export const ALLOWED_CONTENT_TYPES: readonly string[] = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "application/pdf",
];

export const VIDEO_EXTENSIONS: readonly string[] = ["mp4", "mov", "webm", "mkv"];

export const CONTENT_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  pdf: "application/pdf",
};

const CAR_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const OBJECT_NAME_RE = /^[A-Za-z0-9_.-]{1,200}$/;

export interface ParsedMediaPath {
  carId: string;
  kind: MediaKindName;
  objectName: string;
}

/** Lowercased extension without the dot, or "" when the name has none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** The content type implied by a file name, or "" when unrecognised. */
export function contentTypeFor(name: string): string {
  return CONTENT_TYPE_BY_EXTENSION[extensionOf(name)] ?? "";
}

/** True when the id is safe to use as the first path segment. */
export function isValidCarId(carId: string): boolean {
  return CAR_ID_RE.test(carId);
}

/**
 * Parse and validate a full object path. Returns null for anything that is not
 * exactly three well-formed segments — which is what makes traversal
 * ("../", "..%2F", "a/../../b") impossible rather than merely unlikely.
 */
export function parseMediaPath(path: unknown): ParsedMediaPath | null {
  if (typeof path !== "string") return null;
  if (path.length === 0 || path.length > 300) return null;

  const parts = path.split("/");
  if (parts.length !== 3) return null;

  const [carId, kind, objectName] = parts;
  if (!isValidCarId(carId)) return null;
  if (kind !== "video" && kind !== "brochure") return null;
  if (!OBJECT_NAME_RE.test(objectName)) return null;
  // A name of only dots, or a leading dot, is never a real upload.
  if (objectName.startsWith(".")) return null;
  if (/^\.+$/.test(objectName)) return null;

  return { carId, kind, objectName };
}

/** The storage prefix holding one car's files of one kind. */
export function mediaPrefix(carId: string, kind: MediaKindName): string {
  return `${carId}/${kind}`;
}

export type UploadCheck =
  | { ok: true; parsed: ParsedMediaPath }
  | { ok: false; error: string };

/**
 * Everything an upload must satisfy before a signed URL is minted: a valid
 * path, an allowlisted content type, and an extension that agrees with it.
 * "video/mp4" on a file called brochure.pdf is refused, and so is the reverse —
 * the two must tell the same story.
 */
export function checkUpload(path: unknown, contentType: unknown): UploadCheck {
  const parsed = parseMediaPath(path);
  if (!parsed) return { ok: false, error: "Invalid file path." };

  const type =
    typeof contentType === "string" ? contentType.trim().toLowerCase() : "";
  if (!ALLOWED_CONTENT_TYPES.includes(type)) {
    return { ok: false, error: "That file type isn't allowed." };
  }

  const ext = extensionOf(parsed.objectName);
  if (parsed.kind === "video") {
    if (!VIDEO_EXTENSIONS.includes(ext) || !type.startsWith("video/")) {
      return { ok: false, error: "Videos must be MP4, MOV, WebM or MKV files." };
    }
  } else if (ext !== "pdf" || type !== "application/pdf") {
    return { ok: false, error: "The brochure must be a PDF file." };
  }

  // The extension and the declared type must agree with each other.
  if (CONTENT_TYPE_BY_EXTENSION[ext] !== type) {
    return { ok: false, error: "That file type isn't allowed." };
  }

  return { ok: true, parsed };
}

/**
 * Make an uploaded file's original name safe to sit in a path segment while
 * staying recognisable to the person who uploaded it. The extension is kept
 * intact; everything outside [A-Za-z0-9_.-] in the base becomes "-", runs of
 * "_" are collapsed so the display split at the FIRST "__" stays unambiguous,
 * and leading/trailing separators are trimmed. Always returns a non-empty name
 * that satisfies parseMediaPath.
 */
export function safeObjectName(original: string): string {
  const dot = original.lastIndexOf(".");
  const base = dot > 0 ? original.slice(0, dot) : original;

  let safeBase = base
    .replace(/[^A-Za-z0-9_.-]+/g, "-")
    .replace(/_{2,}/g, "_")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 100);
  if (safeBase === "") safeBase = "file";

  // The extension gets the SAME treatment as the base. extensionOf() is
  // "everything after the last dot", which for a name like "../../etc/passwd"
  // is "/etc/passwd" — sanitising only the base used to let separators through
  // and produce a name no path could hold.
  const safeExt = extensionOf(original)
    .replace(/[^A-Za-z0-9]+/g, "")
    .slice(0, 10);

  return safeExt ? `${safeBase}.${safeExt}` : safeBase;
}

/** The name people see: whatever follows the first "__" separator. */
export function displayNameOf(objectName: string): string {
  const at = objectName.indexOf("__");
  return at >= 0 ? objectName.slice(at + 2) : objectName;
}

/** Build a full object path for a fresh upload. `uniquePrefix` is the caller's
 *  id source (crypto.randomUUID() in the browser) — kept as a parameter so this
 *  function stays pure and testable. */
export function buildMediaPath(
  carId: string,
  kind: MediaKindName,
  uniquePrefix: string,
  originalName: string
): string {
  return `${carId}/${kind}/${uniquePrefix}__${safeObjectName(originalName)}`;
}
