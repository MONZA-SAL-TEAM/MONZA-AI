/**
 * GET  /api/sales/alerts                     the open "call this client" alerts
 * POST /api/sales/alerts { id, action: "done" }  a salesperson handled one
 *
 * Created by the sales bot when a customer asks for a price, an offer, stock,
 * installments, a test drive or a trade-in (lib/wasales/sales-ops.ts). Staff
 * only: they carry the customer's name and number.
 */

import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { MEDIA_CAPABILITIES } from "@/lib/permissions/media";
import { alertKindLabel, closeAlert, listOpenAlerts } from "@/lib/wasales/sales-ops";
import { MONZA_KNOWLEDGE, modelByCode } from "@/lib/wasales/knowledge";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request, MEDIA_CAPABILITIES);
  if (!access.ok) {
    return NextResponse.json({ ok: false }, { status: access.reason === "unauthenticated" ? 401 : 403, headers: NO_STORE });
  }
  const alerts = await listOpenAlerts();
  if (alerts === null) {
    return NextResponse.json({ ok: false, message: "Sales alerts are not set up yet." }, { status: 503, headers: NO_STORE });
  }
  return NextResponse.json(
    {
      ok: true,
      alerts: alerts.map((a) => ({
        ...a,
        label: alertKindLabel(a.kind),
        // One alert, every reason: "Wants to buy" + [Test drive, Financing, Stock].
        tagLabels: a.tags.filter((t) => t !== a.kind).map(alertKindLabel),
        cars: a.models.map((m) => modelByCode(MONZA_KNOWLEDGE, m)?.displayName ?? m),
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
  if (!body || body.action !== "done" || typeof body.id !== "string") {
    return NextResponse.json({ ok: false, message: "Unknown request." }, { status: 400, headers: NO_STORE });
  }
  const ok = await closeAlert(body.id, access.user.email?.split("@")[0] || "Monza");
  return NextResponse.json({ ok }, { status: ok ? 200 : 500, headers: NO_STORE });
}
