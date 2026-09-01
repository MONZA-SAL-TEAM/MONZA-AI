/**
 * GET /api/garage — the board the Garage & Vehicles screen renders.
 *
 * Two honest shapes, nothing else (mirrors /api/tracker exactly):
 *   No CRM env  →  { demo: true,  board: <invented dataset> }
 *   CRM env set →  { demo: false, board: null, notReady: "..." }
 *
 * The board is not wired to the live garage or inventory tables yet, so when
 * a CRM connection exists we say so instead of dressing the invented dataset
 * up as live data. Forcing demo:false onto sample data is forbidden — the UI
 * must always be able to trust this flag.
 *
 * Auth mirrors /api/tracker: requireStaff returns the fixed demo identity
 * when no CRM is configured, and fails closed — 401 here — when the CRM is
 * configured and the request carries no valid token.
 */

import { NextResponse } from "next/server";
import { requireStaff, crmConfigured } from "@/lib/auth";
import { DEMO_GARAGE_BOARD } from "@/lib/garage/board-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const user = await requireStaff(request);
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }

  if (crmConfigured()) {
    return NextResponse.json({
      demo: false,
      board: null,
      notReady:
        "The CRM is connected, but the garage board is not wired to the live job cards or inventory yet. Nothing is shown rather than showing invented numbers.",
    });
  }

  return NextResponse.json({ demo: true, board: DEMO_GARAGE_BOARD });
}
