import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { MEDIA_CAPABILITIES } from "@/lib/permissions/media";
import { decodeThreadId } from "@/lib/channels/live-map";
import { sendTemplateOnThread } from "@/lib/channels/live";
import { listReplyTemplates, readReplyTemplate } from "@/lib/channels/wa-templates-server";
import { paramsProblem, TEMPLATE_NAME } from "@/lib/channels/wa-templates";
import { channelsSendLive } from "@/lib/env";

/**
 * WhatsApp templates for replying after the 24-hour window (migration 031).
 *   GET                                    the templates an admin listed and switched on
 *   POST { conversationId, name, params }  send one — a person pressed Send; WhatsApp charges for it
 * Staff who may send messages (Team & access: inbox + send_messages).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request, MEDIA_CAPABILITIES);
  if (!access.ok) return NextResponse.json({ ok: false }, { status: access.reason === "unauthenticated" ? 401 : 403 });
  const list = await listReplyTemplates(true);
  if (!list) return NextResponse.json({ ok: false, message: "The templates could not be read just now." }, { status: 503 });
  return NextResponse.json({ ok: true, templates: list }, { headers: NO_STORE });
}

export async function POST(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request, MEDIA_CAPABILITIES);
  if (!access.ok) return NextResponse.json({ ok: false, message: "You do not have permission to send here." }, { status: access.reason === "unauthenticated" ? 401 : 403 });
  const b = (await request.json().catch(() => null)) as { conversationId?: unknown; name?: unknown; params?: unknown } | null;
  const conversationId = typeof b?.conversationId === "string" ? b.conversationId : "";
  const name = typeof b?.name === "string" && TEMPLATE_NAME.test(b.name) ? b.name : null;
  const params = Array.isArray(b?.params) ? b.params.filter((p): p is string => typeof p === "string").slice(0, 10) : [];
  if (!decodeThreadId(conversationId) || !name) return NextResponse.json({ ok: false, message: "Unknown conversation or template." }, { status: 400 });
  const t = await readReplyTemplate(name);
  if (!t || !t.enabled) return NextResponse.json({ ok: false, message: "That template is not on the list." }, { status: 400 });
  const missing = paramsProblem(t, params);
  if (missing) return NextResponse.json({ ok: false, message: missing }, { status: 400 });
  const outcome = await sendTemplateOnThread(conversationId, t, params, channelsSendLive(), access.user.email?.split("@")[0] || "Monza", access.user.userId);
  console.info(`[channels/template] ${outcome.kind} ${name} by ${access.user.userId}`);
  switch (outcome.kind) {
    case "sent":
      return NextResponse.json({ ok: true, delivered: true }, { headers: NO_STORE });
    case "switched_off":
      return NextResponse.json({ ok: true, delivered: false, message: "Sending is switched off, so nothing was sent." }, { headers: NO_STORE });
    case "window_closed":
      return NextResponse.json({ ok: false, message: outcome.explanation }, { status: 409 });
    default:
      return NextResponse.json({ ok: false, message: outcome.problem }, { status: outcome.status });
  }
}
