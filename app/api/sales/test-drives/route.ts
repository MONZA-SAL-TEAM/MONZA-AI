/**
 * GET  /api/sales/test-drives                       booked test drives from today
 * POST /api/sales/test-drives { id, action: "cancel" }  free a slot
 *
 * The bot books them (lib/wasales/sales-ops.ts); staff see and cancel them here.
 * One booking per slot is the database's rule (migration 014).
 */

import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { MEDIA_CAPABILITIES } from "@/lib/permissions/media";
import { cancelBooking, listBookings } from "@/lib/wasales/sales-ops";
import { slotLabel } from "@/lib/wasales/booking";
import { MONZA_KNOWLEDGE, modelByCode } from "@/lib/wasales/knowledge";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request, MEDIA_CAPABILITIES);
  if (!access.ok) {
    return NextResponse.json({ ok: false }, { status: access.reason === "unauthenticated" ? 401 : 403, headers: NO_STORE });
  }
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const bookings = await listBookings(today.toISOString());
  if (bookings === null) {
    return NextResponse.json({ ok: false, message: "The test-drive calendar is not set up yet." }, { status: 503, headers: NO_STORE });
  }
  return NextResponse.json(
    {
      ok: true,
      bookings: bookings.map((b) => ({
        ...b,
        label: slotLabel(b.slotAt),
        cars: b.models.map((m) => modelByCode(MONZA_KNOWLEDGE, m)?.displayName ?? m),
      })),
    },
    { headers: NO_STORE }
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request, MEDIA_CAPABILITIES);
  if (!access.ok) {
    return NextResponse.json({ ok: false }, { status: access.reason === "unauthenticated" ? 401 : 403, headers: NO_STORE });
  }
  const body = (await request.json().catch(() => null)) as { id?: unknown; action?: unknown } | null;
  if (!body || body.action !== "cancel" || typeof body.id !== "string") {
    return NextResponse.json({ ok: false, message: "Unknown request." }, { status: 400, headers: NO_STORE });
  }
  const ok = await cancelBooking(body.id, access.user.email?.split("@")[0] || "Monza");
  return NextResponse.json({ ok }, { status: ok ? 200 : 500, headers: NO_STORE });
}
