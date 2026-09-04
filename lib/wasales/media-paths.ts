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
 * Object path scheme:
 *
 *     video     <carId>/video/<colourId>/<objectName>
 *     brochure  <carId>/brochure/<objectName>
 *
 *   carId       1–64 of [A-Za-z0-9_-]   — no dots and no slashes, so neither
 *                                          "." nor ".." can ever be a segment
 *   colourId    1–64 of [A-Za-z0-9_-]   — same rule, same reason
 *   objectName  1–200 of [A-Za-z0-9_.-] — no slashes; may not start with a dot
 *                                          and may not be dots only
 *
 * WHY A VIDEO CARRIES ITS COLOUR IN THE PATH. The sales flow asks which colour
 * the customer wants and then sends that colour's videos. It can only do that
 * if every stored video says which colour it shows, and the storage layout is
 * the one place that cannot drift from the file itself — a database column
 * describing an object in a bucket can go stale; a path cannot.
 *
 * So the colour is REQUIRED for videos and REFUSED for brochures. A brochure
 * is colour-independent (one PDF per car, covering every colour), and letting
 * one sit under a colour would quietly create as many "different" brochures as
 * there are colours. Both halves of that rule are enforced in parseMediaPath,
 * which means a video with no colour cannot exist in the bucket — not by
 * convention, but because no code can build a path for one.
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
/** Colour ids obey the same rule as car ids, for the same safety reason. */
const COLOUR_ID_RE = CAR_ID_RE;
const OBJECT_NAME_RE = /^[A-Za-z0-9_.-]{1,200}$/;

export interface ParsedMediaPath {
  carId: string;
  kind: MediaKindName;
  /** Which colour this video shows. Always null for a brochure. */
  colourId: string | null;
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

/** True when the id is safe to use as a colour path segment. */
export function isValidColourId(colourId: string): boolean {
  return COLOUR_ID_RE.test(colourId);
}

/**
 * Turn what a person typed into a colour id: "Midnight Blue" -> "midnight-blue".
 *
 * Returns "" when nothing usable survives, which the caller must treat as a
 * refusal — an empty segment would silently collapse the path.
 */
export function colourIdFrom(typed: string): string {
  return typed
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
}

/**
 * The name to show for a colour id: "midnight-blue" -> "Midnight Blue".
 *
 * The id is the only record a bucket-created colour has — there is no table of
 * display names — so this has to be reversible enough to look deliberate. It
 * is applied ONLY to colours discovered in storage; a colour that came from the
 * sales folder keeps the folder's own capitalisation.
 */
export function colourNameFrom(colourId: string): string {
  return colourId
    .split("-")
    .filter((w) => w !== "")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Parse and validate a full object path.
 *
 * Returns null for anything that is not an exactly-shaped path — four
 * well-formed segments for a video, three for a brochure. Every segment is
 * matched against a character class with no dot and no slash in it, which is
 * what makes traversal ("../", "..%2F", "a/../../b") impossible rather than
 * merely unlikely.
 *
 * The video/brochure asymmetry is deliberate and is the whole point: a video
 * MUST name its colour, a brochure MUST NOT. Anything else is refused here, so
 * the rule holds for every caller at once rather than being re-remembered in
 * each of them.
 */
export function parseMediaPath(path: unknown): ParsedMediaPath | null {
  if (typeof path !== "string") return null;
  if (path.length === 0 || path.length > 300) return null;

  const parts = path.split("/");
  if (parts.length < 3 || parts.length > 4) return null;

  const [carId, kind] = parts;
  if (!isValidCarId(carId)) return null;
  if (kind !== "video" && kind !== "brochure") return null;

  // A video names its colour; a brochure covers every colour and names none.
  const wantsColour = kind === "video";
  if (wantsColour !== (parts.length === 4)) return null;

  const colourId = wantsColour ? parts[2] : null;
  if (colourId !== null && !isValidColourId(colourId)) return null;

  const objectName = parts[parts.length - 1];
  if (!OBJECT_NAME_RE.test(objectName)) return null;
  // A name of only dots, or a leading dot, is never a real upload.
  if (objectName.startsWith(".")) return null;
  if (/^\.+$/.test(objectName)) return null;

  return { carId, kind, colourId, objectName };
}

/**
 * The storage prefix holding one car's files of one kind.
 *
 * For videos a colour narrows it to that colour's own folder; omitting the
 * colour gives the parent, whose immediate children are FOLDERS rather than
 * files — callers listing it must descend, not expect objects.
 */
export function mediaPrefix(
  carId: string,
  kind: MediaKindName,
  colourId?: string | null
): string {
  return kind === "video" && colourId
    ? `${carId}/video/${colourId}`
    : `${carId}/${kind}`;
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
  colourId: string | null,
  uniquePrefix: string,
  originalName: string
): string {
  const name = `${uniquePrefix}__${safeObjectName(originalName)}`;
  return kind === "video"
    ? `${carId}/video/${colourId}/${name}`
    : `${carId}/brochure/${name}`;
}
