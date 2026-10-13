import { NextResponse } from "next/server";
import { cronSecret } from "@/lib/env";
import { isCronAuthorized } from "@/lib/channels/retention";
import { MAX_HOPS, parseJob, runCatchupStep } from "@/lib/insights/catchup-server";

/**
 * GET /api/insights/catchup?job=wa|meta:<account>&hop=N[&lease=…][&restart=1][&wrapped=1][&finish=1] — ONE step of a
 * history read that runs on the server until it is finished (lib/insights/catchup-server.ts). Called by the
 * previous step, the "Read" buttons (through their own staff-only routes) and the nightly job — always with
 * CRON_SECRET; anybody else, and everybody while it is unset, gets 401. Codes and counts only.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: Request): Promise<NextResponse> {
  if (!isCronAuthorized(request.headers.get("authorization"), cronSecret())) {
    return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE });
  }
  const q = new URL(request.url).searchParams;
  const job = await parseJob(q.get("job"));
  if (!job) return NextResponse.json({ ok: false, message: "Unknown job." }, { status: 400, headers: NO_STORE });
  const hop = Math.max(0, Math.min(MAX_HOPS, Number(q.get("hop") ?? 0) || 0));
  const lease = q.get("lease");
  const r = await runCatchupStep({
    origin: new URL(request.url).origin,
    job,
    lease: lease && /^[0-9a-f-]{36}$/.test(lease) ? lease : null,
    hop,
    // A restart only at the first step, or the one "go round once more" step of a resumed WhatsApp read.
    restart: q.get("restart") === "1" && (hop === 0 || q.get("wrapped") === "1"),
    finish: q.get("finish") === "1",
    wrapped: q.get("wrapped") === "1",
  });
  console.log(`[insights/catchup] ${job} step ${hop}: ${r.state}${"code" in r ? ` (${r.code})` : ""}`);
  return NextResponse.json({ ok: r.state !== "unavailable", ...r }, { headers: NO_STORE });
}
