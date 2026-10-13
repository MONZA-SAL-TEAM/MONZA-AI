import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { INSIGHTS_CAPS } from "@/lib/insights/access";
import { catchupStatus, parseJob, startCatchup } from "@/lib/insights/catchup-server";

/**
 * "Read the WhatsApp history again" — and, with `?job=meta:<account>`, an Instagram / Facebook account's
 * history. Owner and managers only.
 *
 *   POST [?restart=1]  starts the read ON THE SERVER and answers at once; it continues on its own, step by
 *                      step, until it is finished (lib/insights/catchup-server.ts). Signing out, closing the
 *                      page or the one-hour sign-in running out no longer stops it (Samer's audit, 2026-10-13).
 *   GET                where it stands: reading or not, steps taken, labels by the current reader.
 *
 * Idempotent: nothing doubles; a second start while one is reading answers "already reading".
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request, INSIGHTS_CAPS);
  if (!access.ok) return NextResponse.json({ ok: false, message: "Not available for your role." }, { status: access.reason === "unauthenticated" ? 401 : 403 });
  const job = await parseJob(new URL(request.url).searchParams.get("job") ?? "wa");
  if (!job) return NextResponse.json({ ok: false, message: "Unknown account." }, { status: 400 });
  const s = await catchupStatus(job);
  if (!s) return NextResponse.json({ ok: false, message: "The database is not reachable here." }, { status: 503 });
  return NextResponse.json({ ok: true, ...s }, { headers: NO_STORE });
}

export async function POST(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request, INSIGHTS_CAPS);
  if (!access.ok) return NextResponse.json({ ok: false, message: "Not available for your role." }, { status: access.reason === "unauthenticated" ? 401 : 403 });
  const q = new URL(request.url).searchParams;
  const job = await parseJob(q.get("job") ?? "wa");
  if (!job) return NextResponse.json({ ok: false, message: "Unknown account." }, { status: 400 });
  const r = await startCatchup(new URL(request.url).origin, job, q.get("restart") === "1");
  const message: Record<typeof r, string> = {
    started: "Reading on the server — it continues by itself; you can close this page.",
    busy: "Already reading on the server.",
    not_configured: "The server cannot continue on its own (CRON_SECRET is not set).",
    unavailable: "The database is not reachable here.",
  };
  return NextResponse.json({ ok: r === "started" || r === "busy", state: r, message: message[r] }, { status: r === "unavailable" ? 503 : r === "not_configured" ? 501 : 200, headers: NO_STORE });
}
