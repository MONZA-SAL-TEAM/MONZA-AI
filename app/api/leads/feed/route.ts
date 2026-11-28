import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { listPeople } from "@/lib/leads/people-server";
import { leadsFeed } from "@/lib/leads/feed";
import { readLeadFacts } from "@/lib/leads/feed-server";

/**
 * GET /api/leads/feed — the leads for the Monza S.A.L. app's Leads page (lib/leads/feed.ts).
 *
 * The Monza app's SERVER calls it with the signed-in person's own CRM token as `Authorization: Bearer …`
 * — the token MONZA AI verifies for its own pages — so exactly the people who may open Customers here
 * may read it (Team & access: page "customers"). There is no shared key for this route: a name or a
 * number is only ever given to a person.
 *
 * Who and where, plus two labels: how far their questions went (the insights reader's stage and the
 * car they mean) and how memorable their number is (lib/leads/number-score.ts — a commercial signal,
 * never a judgment of the person). Never what was said: no message text. Read-only, and nothing is written to the CRM.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request);
  if (!access.ok) return NextResponse.json({ ok: false, message: "Not available for your role." }, { status: access.reason === "unauthenticated" ? 401 : 403, headers: NO_STORE });
  const [people, facts] = await Promise.all([listPeople(), readLeadFacts()]);
  if (!people) return NextResponse.json({ ok: false, message: "MONZA AI's records could not be read just now — not an empty list." }, { status: 503, headers: NO_STORE });
  return NextResponse.json({ ok: true, generatedAt: new Date().toISOString(), ...leadsFeed(people, facts) }, { headers: NO_STORE });
}
