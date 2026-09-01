/**
 * GET /api/customers — the directory the Customers & Sales screen renders.
 *
 * Two honest shapes, nothing else (mirrors /api/tracker and /api/garage):
 *   No CRM env  →  { demo: true,  directory: <invented dataset> }
 *   CRM env set →  { demo: false, directory: null, notReady: "..." }
 *
 * The directory is not wired to the live customer records yet, so when a CRM
 * connection exists we say so instead of dressing the invented dataset up as
 * live data. Forcing demo:false onto sample data is forbidden — the UI must
 * always be able to trust this flag.
 *
 * Auth mirrors /api/garage: requireStaff returns the fixed demo identity
 * when no CRM is configured, and fails closed — 401 here — when the CRM is
 * configured and the request carries no valid token.
 */

import { NextResponse } from "next/server";
import { requireStaff, crmConfigured } from "@/lib/auth";
import { DEMO_CUSTOMER_DIRECTORY } from "@/lib/customers/directory-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const user = await requireStaff(request);
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }

  if (crmConfigured()) {
    return NextResponse.json({
      demo: false,
      directory: null,
      notReady:
        "The CRM is connected, but the customer directory is not wired to the live customer records yet — those arrive with the connection work. Nothing is shown rather than showing invented people.",
    });
  }

  return NextResponse.json({ demo: true, directory: DEMO_CUSTOMER_DIRECTORY });
}
