/**
 * POST /api/channels/send — a staff reply on a channel thread.
 *
 * ── LOG-ONLY UNTIL SOMEBODY DELIBERATELY SAYS OTHERWISE ─────────────────────
 * `CHANNELS_SEND_MODE` must equal "live" for anything to leave the building.
 * Unset, misspelt, or created empty in a dashboard all mean log-only: the reply
 * is stored and appears in the thread, and the customer never sees it.
 *
 * That default is the point of this stage. Receiving, storing, brand routing
 * and human review get proven against real traffic while it is impossible to
 * message a customer by accident.
 *
 * ── A person sends. Always. ─────────────────────────────────────────────────
 * There is no path from an inbound message to an outbound one. The local model
 * in the Inbox DRAFTS; a human presses send; this route requires a real staff
 * identity. Nothing here can be reached by a webhook, so no loop of
 * "customer writes → we answer → we see our answer → we answer again" can
 * exist.
 *
 * ── The request names a conversation, not a recipient ───────────────────────
 * Who this reaches, on which account, under which brand, is looked up from the
 * conversation. A caller cannot name a thread and a different destination, so
 * a compromised or buggy client cannot address a stranger, and cannot send a
 * VOYAH reply out of an MHERO account.
 */

import { NextResponse } from "next/server";
import { requireRealStaff, type StaffAccess } from "@/lib/auth";
import { MEDIA_CAPABILITIES } from "@/lib/permissions/media";
import { channelToken, channelsSendLive } from "@/lib/env";
import { instagramAdapter } from "@/lib/channels/instagram";
import { replyWindow, windowExplanation } from "@/lib/channels/types";
import {
  findConversation,
  storeOutbound,
  type ConversationTarget,
} from "@/lib/channels/store";

export const dynamic = "force-dynamic";

const MAX_LENGTH = 4000;

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

async function deliver(
  target: ConversationTarget,
  text: string
): Promise<{ id: string | null; error: string | null }> {
  if (!channelsSendLive()) {
    // Log-only. Nothing is contacted; the message exists for staff alone.
    return { id: null, error: null };
  }

  const token = channelToken(target.tokenEnv);
  if (!token) {
    return { id: null, error: "This account has no access token on the server." };
  }

  if (target.channel !== "instagram") {
    return { id: null, error: "That channel cannot send yet." };
  }

  const result = await instagramAdapter.send(
    { accountId: target.accountId, toExternalId: target.peerExternalId, text },
    token
  );
  return result.ok
    ? { id: result.externalMessageId, error: null }
    : { id: null, error: result.error };
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

  const conversationId =
    typeof body.conversationId === "string" ? body.conversationId : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";

  if (conversationId === "") return fail("No conversation.", 400, "badRequest");
  if (text === "") return fail("Write something first.", 400, "badRequest");
  if (text.length > MAX_LENGTH) {
    return fail("That message is too long to send.", 400, "badRequest");
  }

  const target = await findConversation(conversationId);
  if (!target) return fail("That conversation no longer exists.", 404, "notFound");

  // THE 24-HOUR RULE, enforced here and not only shown in the UI. A screen can
  // be stale; this cannot. Refusing with the reason is what stops staff
  // believing a message went out when Meta would have dropped it.
  const window = replyWindow(target.lastInboundAt, new Date());
  if (!window.open) {
    return NextResponse.json(
      {
        error: "windowClosed",
        message: windowExplanation(window, target.channel as "instagram"),
      },
      { status: 409 }
    );
  }

  const at = new Date().toISOString();
  const { id, error } = await deliver(target, text);

  // Stored whatever happened, including a failure — a reply staff wrote and
  // believe they sent must be visible in the thread, with its state. Silently
  // dropping it is how somebody follows up on a message the customer never got.
  const saved = await storeOutbound(target, {
    conversationId: target.id,
    text,
    // The CRM's own user id, carried through as an opaque uuid — the same
    // identity the rest of the product audits by.
    staffId: access.user.userId,
    // Email rather than a display name: the identity carries no name, and
    // inventing one for a thread staff will read later would be worse.
    staffName: access.user.email,
    externalMessageId: id,
    status: error ? "failed" : channelsSendLive() ? "sent" : "queued",
    error,
    at,
  });
  if (!saved.ok) return fail("Could not save the reply.", 500, "storageFailed");

  if (error) {
    return NextResponse.json(
      { error: "sendFailed", message: `It was not sent: ${error}` },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    /** False means it was recorded but NOT sent, and the screen must say so
     *  rather than showing a tick the customer never earned. */
    delivered: channelsSendLive(),
  });
}
