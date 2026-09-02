/**
 * POST /api/wasales-media — the ONLY write path into the shared WhatsApp
 * Sales media bucket ("wasales-media" in the MONZA AI Supabase project).
 *
 * The bucket is public-read with NO anon write policy (deliberate). Writes
 * happen with the service-role key, which lives ONLY in the server env as
 * AI_SUPABASE_SERVICE_ROLE_KEY. Until that key is set, every action here
 * answers 503 { error: "keyMissing" } and the page shows the honest state.
 *
 * File bytes NEVER pass through this route (Vercel body limits): the route
 * mints a signed upload URL and the browser uploads straight to Supabase.
 *
 * Actions:
 *   { action: "sign-upload", path, contentType } → { token, path }
 *     For a brochure path, any existing brochure objects for that car are
 *     deleted first — one brochure per car, the new one replaces the old.
 *   { action: "delete", path } → { ok: true }
 *
 * Path scheme (strictly validated, no traversal):
 *   <carId>/<video|brochure>/<objectName>
 *   carId       [a-z0-9-]+       objectName  [A-Za-z0-9_.-]+
 *
 * Auth mirrors the /api/whatsapp-sales family: requireStaff returns the demo
 * identity when no CRM is configured, and fails closed (401) when the CRM is
 * configured and the request carries no valid token.
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireStaff } from "@/lib/auth";

export const dynamic = "force-dynamic";

const BUCKET = "wasales-media";

const PATH_RE = /^([a-z0-9-]+)\/(video|brochure)\/([A-Za-z0-9_.-]+)$/;

/** The bucket's MIME allowlist. */
const ALLOWED_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "application/pdf",
]);

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "mkv"]);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function bad(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: Request): Promise<NextResponse> {
  const user = await requireStaff(request);
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return bad("The request body must be JSON.");
  }
  const body = (raw && typeof raw === "object" ? raw : {}) as {
    action?: unknown;
    path?: unknown;
    contentType?: unknown;
    keepPath?: unknown;
  };

  const action = body.action;
  if (
    action !== "sign-upload" &&
    action !== "delete" &&
    action !== "sweep-brochure"
  ) {
    return bad("Unknown action.");
  }

  const path = typeof body.path === "string" ? body.path : "";
  if (path.length === 0 || path.length > 300) {
    return bad("Invalid file path.");
  }
  const match = PATH_RE.exec(path);
  if (!match) {
    return bad("Invalid file path.");
  }
  const carId = match[1];
  const kind = match[2] as "video" | "brochure";
  const objectName = match[3];
  // [A-Za-z0-9_.-]+ would let a name of only dots through — refuse those.
  if (/^\.+$/.test(objectName)) {
    return bad("Invalid file path.");
  }

  // Same public default as the client (env wins). Only the service key is
  // secret and must come from the environment.
  const url =
    process.env.NEXT_PUBLIC_AI_SUPABASE_URL ??
    "https://fpsgsgldepgcowyivoow.supabase.co";
  const rawKey = process.env.AI_SUPABASE_SERVICE_ROLE_KEY;
  const serviceKey = typeof rawKey === "string" ? rawKey.trim() : rawKey;
  if (!url || !serviceKey) {
    // Diagnostic detail only — says whether the variable exists at all and
    // roughly how long it is. Never any part of the value.
    const detail =
      rawKey === undefined
        ? "absent"
        : rawKey.trim() === ""
          ? "empty"
          : "present";
    return NextResponse.json(
      { error: "keyMissing", keyState: detail, keyLength: rawKey ? rawKey.length : 0 },
      { status: 503 }
    );
  }

  const svc = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (action === "sweep-brochure") {
    // Called by the browser AFTER a successful brochure upload: remove every
    // brochure object for the car EXCEPT the one just uploaded (keepPath).
    const keepPath = typeof body.keepPath === "string" ? body.keepPath : "";
    if (!PATH_RE.test(keepPath) || !keepPath.includes("/brochure/")) {
      return bad("Invalid file path.");
    }
    const carId = keepPath.split("/")[0];
    try {
      const { data: existing } = await svc.storage
        .from(BUCKET)
        .list(`${carId}/brochure`, { limit: 100 });
      const olds = (existing ?? [])
        .map((e) => (typeof e.name === "string" ? e.name : ""))
        .filter((n) => n !== "" && !n.startsWith("."))
        .map((n) => `${carId}/brochure/${n}`)
        .filter((p) => p !== keepPath);
      if (olds.length > 0) {
        await svc.storage.from(BUCKET).remove(olds);
      }
    } catch {
      // A failed sweep leaves an extra old file; the next replace retries.
    }
    return NextResponse.json({ ok: true });
  }

  if (action === "delete") {
    const { error } = await svc.storage.from(BUCKET).remove([path]);
    if (error) {
      return NextResponse.json(
        { error: "Couldn't delete the file — please try again." },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true });
  }

  /* ----- sign-upload ----- */

  const contentType =
    typeof body.contentType === "string" ? body.contentType.toLowerCase() : "";
  if (!ALLOWED_TYPES.has(contentType)) {
    return bad("That file type isn't allowed.");
  }
  const ext = extensionOf(objectName);
  if (kind === "video") {
    if (!VIDEO_EXTENSIONS.has(ext) || !contentType.startsWith("video/")) {
      return bad("Videos must be MP4, MOV, WebM or MKV files.");
    }
  } else {
    if (ext !== "pdf" || contentType !== "application/pdf") {
      return bad("The brochure must be a PDF file.");
    }
  }

  // NOTE: the one-brochure-per-car sweep happens AFTER the browser confirms
  // the new upload (action "sweep-brochure"), never before — deleting first
  // would leave the car with NO brochure if the upload then failed.

  const { data, error } = await svc.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data?.token) {
    return NextResponse.json(
      { error: "Couldn't prepare the upload — please try again." },
      { status: 500 }
    );
  }
  return NextResponse.json({ token: data.token, path });
}
