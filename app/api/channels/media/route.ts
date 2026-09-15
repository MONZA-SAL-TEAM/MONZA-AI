/**
 * POST /api/channels/media — permission to upload ONE file for a WhatsApp
 * reply: a photo, video, voice note or document (Samer, 2026-09-15).
 *
 * The file itself never passes through here (Vercel refuses request bodies
 * over 4.5 MB): this answers with a one-time signed upload, the browser puts
 * the file straight into the private `whatsapp-media` bucket, and
 * /api/channels/send then sends it. Same pattern as /api/wasales-media.
 *
 * Every gate the send has is checked BEFORE the upload — a real staff member,
 * a WhatsApp conversation, an open 24-hour window, sending switched on, the
 * key present, and a file WhatsApp accepts — so nobody waits for an upload
 * that could never go. Where the file goes is chosen here, under this
 * conversation; the browser cannot name a path.
 */

import { NextResponse } from "next/server";
import { requireRealStaff, type StaffAccess } from "@/lib/auth";
import { MEDIA_CAPABILITIES } from "@/lib/permissions/media";
import { channelsSendLive } from "@/lib/env";
import { decodeThreadId } from "@/lib/channels/live-map";
import { prepareWhatsAppUpload } from "@/lib/channels/live";
import { WA_MEDIA_BUCKET } from "@/lib/channels/wa-media";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function fail(message: string, status: number, code: string): NextResponse {
  return NextResponse.json({ error: code, message }, { status });
}

function refuse(access: Extract<StaffAccess, { ok: false }>): NextResponse {
  if (access.reason === "demo_mode") {
    return fail("Files cannot be sent from the example data — sign in with your Monza account.", 403, "demoMode");
  }
  if (access.reason === "unauthenticated") return fail("Please sign in.", 401, "signInRequired");
  return fail("You do not have permission to reply here.", 403, "forbidden");
}

export async function POST(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request, MEDIA_CAPABILITIES);
  if (!access.ok) return refuse(access);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail("The request body must be JSON.", 400, "badRequest");
  }
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const ids = decodeThreadId(body.conversationId);
  if (!ids) return fail("No conversation.", 400, "badRequest");

  const grant = await prepareWhatsAppUpload(
    body.conversationId,
    { kind: body.kind, mime: body.mime, size: body.size },
    channelsSendLive()
  );
  // Ids only — never the file's name, which a customer-facing file may carry.
  console.info(`[channels/media] ${grant.kind} on ${ids.accountId} by ${access.user.userId}`);

  switch (grant.kind) {
    case "ok":
      return NextResponse.json({ ok: true, bucket: WA_MEDIA_BUCKET, path: grant.path, token: grant.token });
    case "switched_off":
      return fail("Sending is switched off for now, so nothing was sent.", 409, "switchedOff");
    case "window_closed":
      return fail(grant.explanation, 409, "windowClosed");
    case "refused":
      return fail(grant.problem, grant.status, "uploadRefused");
  }
}
