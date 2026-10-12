import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { listOwners } from "@/lib/leads/ownership-server";

/**
 * GET /api/conversations/owners — every owned lead, keyed by the inbox's thread id, and who is asking:
 * the inbox's "Mine" and "Unassigned" filters. Staff only. Names of staff, never of customers.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request);
  if (!access.ok) return NextResponse.json({ ok: false }, { status: access.reason === "unauthenticated" ? 401 : 403 });
  const owners = await listOwners();
  if (!owners) return NextResponse.json({ ok: false, message: "Owners could not be read." }, { status: 503 });
  return NextResponse.json({ ok: true, me: access.user.userId, owners }, { headers: { "Cache-Control": "no-store" } });
}
