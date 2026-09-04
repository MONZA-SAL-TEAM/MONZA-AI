/**
 * POST /api/wasales-media — the ONLY write path into the shared media library
 * ("wasales-media" in the MONZA AI Supabase project).
 *
 * ── Authorization ───────────────────────────────────────────────────────────
 * Every action here MUTATES a real, shared production resource, so every action
 * requires a REAL staff identity: requireRealStaff() refuses the demo identity
 * outright.
 *
 * This is deliberate and it is the fix for a confirmed vulnerability. The route
 * used to call requireStaff(), which returns the fixed DEMO_IDENTITY to ANY
 * caller whenever no CRM is configured — the live production state. An
 * anonymous request could therefore mint upload tokens and delete files. Demo
 * mode is for invented data; it has no business reaching real infrastructure.
 *
 * Reads are NOT handled here and are unaffected: the bucket is public-read by
 * design, and the browser lists it with the anon key.
 *
 * ── Disclosure ──────────────────────────────────────────────────────────────
 * Failures return a plain sentence and a stable machine code. No key state, no
 * key length, no storage-service message, no stack trace ever reaches a client;
 * diagnostics go to the server log, which only an operator can read.
 *
 * ── Transport ───────────────────────────────────────────────────────────────
 * File bytes NEVER pass through this route (serverless body limits): it mints a
 * signed upload URL and the browser uploads straight to Supabase.
 *
 * Actions
 *   { action: "sign-upload",    path, contentType } -> { token, path }
 *   { action: "sweep-brochure", keepPath }          -> { ok: true }
 *       Retires every OTHER brochure for that car. Called only AFTER the new
 *       upload lands, so a failed upload can never leave a car with none.
 *   { action: "delete",         path }              -> { ok: true }
 *
 * Path rules live in lib/wasales/media-paths.ts — one definition, shared with
 * the browser store, directly tested.
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireRealStaff, type StaffAccess } from "@/lib/auth";
import {
  MEDIA_CAPABILITIES,
  mediaWriteRefusal,
  type MediaErrorCode,
} from "@/lib/permissions/media";
import { aiServiceRoleKey, aiUrl } from "@/lib/env";
import {
  MEDIA_BUCKET,
  checkUpload,
  mediaPrefix,
  parseMediaPath,
} from "@/lib/wasales/media-paths";

export const dynamic = "force-dynamic";

function fail(
  code: MediaErrorCode,
  message: string,
  status: number
): NextResponse {
  return NextResponse.json({ error: code, message }, { status });
}

/** Turn a refused access result into the right honest response. The policy
 *  itself lives in lib/permissions/media.ts, where it is tested. */
function refuse(access: Extract<StaffAccess, { ok: false }>): NextResponse {
  const r = mediaWriteRefusal(access);
  return fail(r.code, r.message, r.status);
}

export async function POST(request: Request): Promise<NextResponse> {
  // Authorization FIRST: nothing is parsed, and no secret is read, until the
  // caller has proved they are real staff allowed to do this.
  const access = await requireRealStaff(request, MEDIA_CAPABILITIES);
  if (!access.ok) return refuse(access);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail("badRequest", "The request body must be JSON.", 400);
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
    return fail("badRequest", "Unknown action.", 400);
  }

  const serviceKey = aiServiceRoleKey();
  if (!serviceKey) {
    // Presence only, in the SERVER log. The response says nothing about the
    // key beyond "the library isn't ready" — a length or state in the body is
    // an oracle, however small.
    console.error(
      "[wasales-media] AI_SUPABASE_SERVICE_ROLE_KEY is not set; refusing write."
    );
    return fail(
      "keyMissing",
      "The shared media library is not ready on this server yet.",
      503
    );
  }

  const svc = createClient(aiUrl(), serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  /* ── sweep-brochure ─────────────────────────────────────────────────────
   * Validates keepPath, NOT path — the browser sends only keepPath here. The
   * previous version validated `path` for every action before branching, so
   * every sweep answered 400 and old brochures were never retired. */
  if (action === "sweep-brochure") {
    const keep = parseMediaPath(body.keepPath);
    if (!keep || keep.kind !== "brochure") {
      return fail("badRequest", "Invalid file path.", 400);
    }
    const keepPath = body.keepPath as string;
    try {
      const { data: existing, error } = await svc.storage
        .from(MEDIA_BUCKET)
        .list(mediaPrefix(keep.carId, "brochure"), { limit: 100 });
      if (error) throw error;
      const olds = (existing ?? [])
        .map((e) => (typeof e.name === "string" ? e.name : ""))
        .filter((n) => n !== "" && !n.startsWith("."))
        .map((n) => `${keep.carId}/brochure/${n}`)
        .filter((p) => p !== keepPath);
      if (olds.length > 0) {
        const { error: rmError } = await svc.storage
          .from(MEDIA_BUCKET)
          .remove(olds);
        if (rmError) throw rmError;
      }
    } catch (e) {
      console.error("[wasales-media] brochure sweep failed:", e);
      return fail(
        "storageFailed",
        "The new brochure is saved, but the previous one could not be removed.",
        500
      );
    }
    return NextResponse.json({ ok: true });
  }

  /* ── delete ────────────────────────────────────────────────────────────── */

  if (action === "delete") {
    const parsed = parseMediaPath(body.path);
    if (!parsed) return fail("badRequest", "Invalid file path.", 400);

    const { error } = await svc.storage
      .from(MEDIA_BUCKET)
      .remove([body.path as string]);
    if (error) {
      console.error("[wasales-media] delete failed:", error);
      return fail(
        "storageFailed",
        "Couldn't delete the file — please try again.",
        500
      );
    }
    return NextResponse.json({ ok: true });
  }

  /* ── sign-upload ───────────────────────────────────────────────────────── */

  const check = checkUpload(body.path, body.contentType);
  if (!check.ok) return fail("badRequest", check.error, 400);

  // NOTE: the one-brochure-per-car sweep happens AFTER the browser confirms
  // the new upload (action "sweep-brochure"), never before — deleting first
  // would leave the car with NO brochure if the upload then failed.
  const path = body.path as string;
  const { data, error } = await svc.storage
    .from(MEDIA_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data?.token) {
    console.error(
      "[wasales-media] createSignedUploadUrl failed:",
      error ?? "no token returned"
    );
    return fail(
      "storageFailed",
      "Couldn't prepare the upload — please try again.",
      500
    );
  }
  return NextResponse.json({ token: data.token, path });
}
