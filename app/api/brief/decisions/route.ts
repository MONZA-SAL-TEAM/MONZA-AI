import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/channels/retention";
import { channelDb } from "@/lib/channels/store";
import { briefFeedSecret } from "@/lib/env";
import { summariseDecisions, WAITING_STATES, type DecisionRow } from "@/lib/brief/decisions-summary";

export const dynamic = "force-dynamic";

/**
 * GET /api/brief/decisions — the Decision Center, COUNTED, for the Monza S.A.L.
 * app's 08:00 morning brief (owner, 24 Nov 2026).
 *
 * Called server to server by the CRM's morning job with
 * `Authorization: Bearer <BRIEF_FEED_SECRET>` (its own secret, never CRON_SECRET,
 * set in both apps' Vercel settings). Unset or wrong → 401, nothing read.
 *
 * Answers counts and labels per rule for items still waiting on a person (open,
 * escalated) — never a subject, a name, a phone or a chat: the CRM job has no
 * signed-in viewer, and MONZA AI gives no customer identity to a background
 * caller. A read that fails answers 503, never an empty list.
 */
export async function GET(request: Request): Promise<NextResponse> {
  if (!isCronAuthorized(request.headers.get("authorization"), briefFeedSecret())) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    const sb = channelDb();
    if (!sb) return NextResponse.json({ ok: false }, { status: 503 });
    const { data, error } = await sb
      .from("insight_decisions")
      .select("rule, severity, state, first_seen, last_seen")
      .in("state", [...WAITING_STATES])
      .limit(5000);
    if (error) throw error;
    return NextResponse.json({ ok: true, ...summariseDecisions((data ?? []) as DecisionRow[]) });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
