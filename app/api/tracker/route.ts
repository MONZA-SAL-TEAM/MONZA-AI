/**
 * GET /api/tracker — the month the Installments & Payments screen renders.
 *
 * Two honest shapes, nothing else:
 *   No CRM env  →  { demo: true,  month: <invented August 2026 dataset> }
 *   CRM env set →  { demo: false, month: null, notReady: "..." }
 *
 * The tracker is not wired to the live installment tables yet, so when a CRM
 * connection exists we say so instead of dressing the invented dataset up as
 * live data. Forcing demo:false onto sample data is forbidden — the UI must
 * always be able to trust this flag.
 *
 * Auth mirrors /api/chat and /api/conversations: requireStaff returns the
 * fixed demo identity when no CRM is configured (the page works with zero
 * credentials), and fails closed — 401 here — when the CRM is configured and
 * the request carries no valid token.
 */

import { NextResponse } from "next/server";
import { requireStaff, crmConfigured } from "@/lib/auth";
import { DEMO_TRACKER_MONTH } from "@/lib/tracker/demo-month";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const user = await requireStaff(request);
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }

  if (crmConfigured()) {
    return NextResponse.json({
      demo: false,
      month: null,
      notReady:
        "The CRM is connected, but the payment tracker is not wired to the live installment data yet. Nothing is shown rather than showing invented numbers.",
    });
  }

  return NextResponse.json({ demo: true, month: DEMO_TRACKER_MONTH });
}
