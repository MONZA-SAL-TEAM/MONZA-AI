/**
 * POST /api/channels/send — a staff reply on a live Instagram or Facebook
 * thread. It goes out through Meta, so it also appears in the Instagram and
 * Facebook apps. MONZA AI keeps no copy of it (Samer, 2026-09-10).
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
import { sendOnThread } from "@/lib/channels/live";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_LENGTH = 1000;

function fail(message: string, status: number, code: string): NextResponse {
  return NextResponse.json({ error: code, message }, { status });
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
  };

  const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";

  const ids = decodeThreadId(conversationId);
  if (!ids) return fail("No conversation.", 400, "badRequest");
  if (text === "") return fail("Write something first.", 400, "badRequest");
  // Instagram's own limit is 1,000 characters; refusing here beats Meta
  // refusing after the person thinks it went.
  if (text.length > MAX_LENGTH) {
    return fail("That message is too long to send (1,000 characters at most).", 400, "badRequest");
  }

  const outcome = await sendOnThread(conversationId, text, channelsSendLive());

  // Counts and ids only — never the text (it is customer-facing content).
  console.info(`[channels/send] ${outcome.kind} on ${ids.accountId} by ${access.user.userId}`);

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
