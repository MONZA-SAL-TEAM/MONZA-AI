import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { saveAccess } from "@/lib/access/admin-server";
import { staffName } from "@/lib/insights/activity-server";

/**
 * POST /api/admin/access { userId, name?, email?, setting | null } — set one person's MONZA AI access, or remove
 * the setting (back to the CRM role). Admins only: the route's rule (lib/access apiRuleOf → page "admin") is
 * checked by requireRealStaff, and again here. Every change is logged with who made it (staff_access_log).
 */
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRESETS = ["full", "manager", "sales", "viewer", "custom"] as const;

export async function POST(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request);
  if (!access.ok) return NextResponse.json({ ok: false, message: "Only an admin can change access." }, { status: access.reason === "unauthenticated" ? 401 : 403 });
  if (!access.user.access?.admin) return NextResponse.json({ ok: false, message: "Only an admin can change access." }, { status: 403 });
  const b = (await request.json().catch(() => null)) as { userId?: unknown; name?: unknown; email?: unknown; setting?: Record<string, unknown> | null } | null;
  const userId = typeof b?.userId === "string" && UUID.test(b.userId) ? b.userId : null;
  if (!userId) return NextResponse.json({ ok: false, message: "Unknown person." }, { status: 400 });
  const s = b?.setting;
  const preset = PRESETS.find((p) => p === s?.preset) ?? "custom";
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const r = await saveAccess(
    { id: access.user.userId, name: await staffName(access.user) },
    {
      userId,
      name: typeof b?.name === "string" ? b.name : null,
      email: typeof b?.email === "string" ? b.email : null,
      setting: s === null ? null : { isAdmin: s?.isAdmin === true, blocked: s?.blocked === true, preset, pages: list(s?.pages), actions: list(s?.actions) },
    }
  );
  if (!r.ok) return NextResponse.json({ ok: false, message: r.reason }, { status: r.status });
  return NextResponse.json({ ok: true, message: "Saved — in force within 15 seconds." }, { headers: { "Cache-Control": "no-store" } });
}
