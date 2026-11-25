/**
 * POST /api/sales/test-drives/requests   a person moves a test-drive request along
 *   { id, to, slotAt?, vehicle?, salespersonId?, nextAction? }
 *
 * The lifecycle (lib/testdrives/lifecycle.ts): requested → contacted → awaiting confirmation →
 * booked (date, car, salesperson) → completed (what happens next) | no-show, or at any time
 * declined / cancelled / no longer interested / duplicate. The salesperson of a booking must be on
 * the assignable list read as the caller — the browser cannot name anyone.
 */

import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { MEDIA_CAPABILITIES } from "@/lib/permissions/media";
import { actorOf, assignableStaff } from "@/lib/leads/ownership-server";
import { changeTestDrive } from "@/lib/testdrives/lifecycle-server";
import { isNextAction, isTestDriveStatus } from "@/lib/testdrives/lifecycle";
import { MONZA_KNOWLEDGE, modelByCode } from "@/lib/wasales/knowledge";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function POST(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request, MEDIA_CAPABILITIES);
  if (!access.ok) {
    return NextResponse.json({ ok: false }, { status: access.reason === "unauthenticated" ? 401 : 403, headers: NO_STORE });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.id !== "string" || !isTestDriveStatus(body.to)) {
    return NextResponse.json({ ok: false, message: "Unknown request." }, { status: 400, headers: NO_STORE });
  }
  let salespersonId: string | null = null;
  let salespersonName: string | null = null;
  let vehicle: string | null = null;
  if (body.to === "booked") {
    const staff = await assignableStaff(access.user);
    const pick = staff.find((s) => s.id === body.salespersonId);
    if (!pick) return NextResponse.json({ ok: false, message: "Choose the salesperson from the list." }, { status: 400, headers: NO_STORE });
    salespersonId = pick.id;
    salespersonName = pick.name;
    // The car is one of the workbook's models, by its code — never free text.
    const model = typeof body.vehicle === "string" ? modelByCode(MONZA_KNOWLEDGE, body.vehicle as never) : null;
    if (!model) return NextResponse.json({ ok: false, message: "Choose the car from the list." }, { status: 400, headers: NO_STORE });
    vehicle = model.code;
  }
  const actor = await actorOf(access.user);
  const result = await changeTestDrive(
    body.id,
    {
      to: body.to,
      slotAt: typeof body.slotAt === "string" ? body.slotAt : null,
      vehicle,
      salespersonId,
      salespersonName,
      nextAction: isNextAction(body.nextAction) ? body.nextAction : null,
    },
    { id: actor.id, name: actor.name }
  );
  if (!result.ok) return NextResponse.json({ ok: false, message: result.reason }, { status: result.status, headers: NO_STORE });
  return NextResponse.json({ ok: true, status: result.status }, { headers: NO_STORE });
}
