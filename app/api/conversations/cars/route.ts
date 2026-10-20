import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { MEDIA_CAPABILITIES } from "@/lib/permissions/media";
import { listConversationCars } from "@/lib/inbox/cars-server";

/**
 * GET /api/conversations/cars — which car each conversation is about, by the inbox's thread id, and the cars
 * to choose from: the inbox's car filter (Samer, 2026-10-20: "so I can upsell for a car I want"). Staff only.
 * Car codes only — never a name, a number or a word a customer wrote. Gated like the other inbox data routes
 * (sales / manage_team by CRM role; the pages ticked in Team & access for anyone set there).
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request, MEDIA_CAPABILITIES);
  if (!access.ok) return NextResponse.json({ ok: false }, { status: access.reason === "unauthenticated" ? 401 : 403 });
  const view = await listConversationCars();
  if (!view) return NextResponse.json({ ok: false, message: "The cars could not be read." }, { status: 503 });
  return NextResponse.json({ ok: true, ...view }, { headers: { "Cache-Control": "no-store" } });
}
