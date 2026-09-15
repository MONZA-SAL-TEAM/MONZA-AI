/**
 * POST /api/channels/send — a staff reply on a live Instagram, Facebook or
 * WhatsApp thread. It goes out through Meta, so it also appears in the
 * Instagram and Facebook apps, and on the phone for WhatsApp. MONZA AI keeps no
 * copy of Instagram and Facebook replies (Samer, 2026-09-10); a WhatsApp reply
 * is recorded in its thread, because WhatsApp is stored (2026-09-15).
 *
 * ── SWITCHED OFF UNTIL SOMEBODY DELIBERATELY SAYS OTHERWISE ─────────────────
 * `CHANNELS_SEND_MODE` must equal "live" for anything to leave the building.
 * Unset, misspelt, or created empty in a dashboard all mean OFF: nothing is
 * sent, nothing is saved, and the screen says so plainly.
 *
 * ── A person sends. Always. ─────────────────────────────────────────────────
 * There is no path from an inbound message to an outbound one. The route
 * requires a real staff identity, and nothing here can be reached by a
 * webhook, so no automatic reply loop can exist.
 *
 * ── The request names a conversation, not a recipient ───────────────────────
 * Who this reaches, from which brand's account, is read from the conversation
 * on Meta with that account's own token (lib/channels/live.ts). A caller cannot
 * address a stranger or send one brand's reply out of another's account.
 */

import { NextResponse } from "next/server";
import { requireRealStaff, type StaffAccess } from "@/lib/auth";
import { MEDIA_CAPABILITIES } from "@/lib/permissions/media";
import { channelsSendLive } from "@/lib/env";
import { decodeThreadId } from "@/lib/channels/live-map";
import { sendOnThread, type OutgoingAttachment } from "@/lib/channels/live";
import { WHATSAPP_MAX_CAPTION, WHATSAPP_MAX_TEXT } from "@/lib/channels/whatsapp";
import { isOutboundKind } from "@/lib/channels/wa-media";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_LENGTH = 1000;

function fail(message: string, status: number, code: string): NextResponse {
  return NextResponse.json({ error: code, message }, { status });
}

/**
 * The file part of a request, as named by the browser. Its path is checked
 * against the conversation in lib/channels/live.ts — here it is only shape.
 */
function attachmentOf(value: unknown): OutgoingAttachment | null | "bad" {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object") return "bad";
  const a = value as Record<string, unknown>;
  if (typeof a.path !== "string" || a.path.length > 300 || !isOutboundKind(a.kind)) return "bad";
  return {
    path: a.path,
    kind: a.kind,
    ...(typeof a.filename === "string" ? { filename: a.filename.slice(0, 200) } : {}),
    ...(a.voice === true ? { voice: true } : {}),
  };
}

function refuse(access: Extract<StaffAccess, { ok: false }>): NextResponse {
  if (access.reason === "demo_mode") {
    return fail(
      "Replies cannot be sent from the example data — sign in with your Monza account.",
      403,
      "demoMode"
    );
  }
  if (access.reason === "unauthenticated") {
    return fail("Please sign in.", 401, "signInRequired");
  }
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
  const body = (raw && typeof raw === "object" ? raw : {}) as {
    conversationId?: unknown;
    text?: unknown;
    attachment?: unknown;
  };

  const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const attachment = attachmentOf(body.attachment);

  const ids = decodeThreadId(conversationId);
  if (!ids) return fail("No conversation.", 400, "badRequest");
  if (attachment === "bad") return fail("That attachment is not valid.", 400, "badRequest");
  if (text === "" && !attachment) return fail("Write something first.", 400, "badRequest");

  const whatsapp = ids.accountId.startsWith("wa-");
  if (attachment) {
    if (attachment.kind === "audio" && text !== "") {
      return fail("A voice note or audio file cannot carry words — send them as a separate message.", 400, "badRequest");
    }
    // WhatsApp carries a caption under the file; Instagram and Facebook send
    // the words as their own message, within their own 1,000.
    const max = whatsapp ? WHATSAPP_MAX_CAPTION : MAX_LENGTH;
    if (text.length > max) {
      return fail(`Those words are too long (${max.toLocaleString("en-US")} characters at most).`, 400, "badRequest");
    }
  } else {
    // Instagram's own limit is 1,000 characters, WhatsApp's 4,096 (our WhatsApp
    // account ids start "wa-"); refusing here beats Meta refusing after the
    // person thinks it went.
    const max = whatsapp ? WHATSAPP_MAX_TEXT : MAX_LENGTH;
    if (text.length > max) {
      return fail(`That message is too long to send (${max.toLocaleString("en-US")} characters at most).`, 400, "badRequest");
    }
  }

  // Shown under the reply in a WhatsApp thread: the part of the email before "@".
  const staffName = access.user.email?.split("@")[0] || "Monza";
  const outcome = await sendOnThread(
    conversationId,
    text,
    channelsSendLive(),
    staffName,
    attachment ?? undefined,
    access.user.userId
  );

  // Counts and ids only — never the text or a file name (customer-facing content).
  console.info(
    `[channels/send] ${outcome.kind}${attachment ? ` (${attachment.kind})` : ""} on ${ids.accountId} by ${access.user.userId}`
  );

  switch (outcome.kind) {
    case "sent":
      return NextResponse.json({ ok: true, delivered: true });
    case "switched_off":
      return NextResponse.json({
        ok: true,
        delivered: false,
        message: "Sending is switched off for now, so nothing was sent.",
      });
    case "window_closed":
      return NextResponse.json(
        { error: "windowClosed", message: outcome.explanation },
        { status: 409 }
      );
    case "refused":
      return fail(outcome.problem, outcome.status, "sendFailed");
  }
}
