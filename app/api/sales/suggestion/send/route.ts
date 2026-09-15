/**
 * POST /api/sales/suggestion/send — { thread, version }
 *
 * A PERSON pressed "Send this" on a sales suggestion. The suggestion is worked
 * out again here, from the chat as it stands now — the browser's copy is never
 * trusted — and it goes out only if it is still the version they saw. Then it
 * is sent part by part through the same gates as a typed reply (24-hour
 * window, CHANNELS_SEND_MODE, the account's key).
 *
 * ── A person sends. Always. ─────────────────────────────────────────────────
 * This route requires a real staff identity and nothing reaches it from a
 * webhook, so it cannot become an automatic reply (CLAUDE.md rule 24).
 */

import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { MEDIA_CAPABILITIES } from "@/lib/permissions/media";
import { sendSuggestion } from "@/lib/wasales/suggestion-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request, MEDIA_CAPABILITIES);
  if (!access.ok) {
    const status = access.reason === "unauthenticated" ? 401 : 403;
    const message =
      access.reason === "demo_mode"
        ? "Replies cannot be sent from the example data — sign in with your Monza account."
        : status === 401
          ? "Please sign in."
          : "You do not have permission to reply here.";
    return NextResponse.json({ ok: false, message }, { status });
  }

  const body = (await request.json().catch(() => null)) as { thread?: unknown; version?: unknown } | null;
  if (!body || typeof body.thread !== "string" || typeof body.version !== "string") {
    return NextResponse.json({ ok: false, message: "Unknown request." }, { status: 400 });
  }

  // Shown under WhatsApp messages: the part of the email before "@".
  const staffName = access.user.email?.split("@")[0] || "Monza";
  const r = await sendSuggestion(body.thread, body.version, staffName);
  return NextResponse.json(r.body, { status: r.status });
}
