/**
 * GET /api/whatsapp-sales — the catalog the WhatsApp Sales Control page renders.
 *
 * Two honest shapes, nothing else (the family pattern from /api/tracker):
 *   No CRM env  →  { demo: true,  catalog: <fixed example catalog> }
 *   CRM env set →  { demo: false, catalog: null, notReady: "..." }
 *
 * No WhatsApp Business number is connected yet, so there is nothing live to
 * catalog and nothing can actually send. When a CRM connection exists we say
 * so instead of dressing the example catalog up as live data. Forcing
 * demo:false onto sample data is forbidden — the UI must always be able to
 * trust this flag.
 *
 * Auth mirrors /api/tracker: requireStaff returns the fixed demo identity
 * when no CRM is configured (the page works with zero credentials), and
 * fails closed — 401 here — when the CRM is configured and the request
 * carries no valid token.
 */

import { NextResponse } from "next/server";
import { requireStaff, crmConfigured } from "@/lib/auth";
import { WASALES_CATALOG } from "@/lib/wasales/catalog-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const user = await requireStaff(request);
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }

  if (crmConfigured()) {
    return NextResponse.json({
      demo: false,
      catalog: null,
      notReady:
        "The CRM is connected, but live car cataloging and automatic sending arrive with the WhatsApp Business connection work. Nothing is shown rather than showing an invented catalog.",
    });
  }

  return NextResponse.json({ demo: true, catalog: WASALES_CATALOG });
}
