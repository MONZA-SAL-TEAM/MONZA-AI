import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { rebuildWhatsApp } from "@/lib/wasales/signal-server";
import { INSIGHTS_CAPS } from "@/lib/insights/access";

/**
 * "Read the WhatsApp history": replay the stored WhatsApp conversations through the insights reader and
 * record their labels (never their words). One call reads for ~45 s and says whether it finished; the
 * page calls again until it has. `?restart=1` starts again from the first conversation.
 * Owner and managers only. Idempotent: nothing doubles.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request, INSIGHTS_CAPS);
  if (!access.ok) return NextResponse.json({ ok: false, message: "Not available for your role." }, { status: access.reason === "unauthenticated" ? 401 : 403 });
  const restart = new URL(request.url).searchParams.get("restart") === "1";
  const r = await rebuildWhatsApp(45_000, restart);
  if (!r) return NextResponse.json({ ok: false, message: "The database is not reachable here." }, { status: 503 });
  return NextResponse.json(
    { ok: true, ...r, message: `Read ${r.conversations} conversations (${r.messages} messages): ${r.signals} customer messages and ${r.observations} facts recorded.` },
    { headers: { "Cache-Control": "no-store" } }
  );
}
