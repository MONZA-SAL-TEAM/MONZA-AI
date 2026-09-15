/**
 * GET /api/channels/retention — the daily 12-month clean-up of stored WhatsApp
 * messages (Samer, 2026-09-15; lib/channels/retention.ts).
 *
 * Called by Vercel Cron (vercel.json), which sends `Authorization: Bearer
 * <CRON_SECRET>`. Anybody else — and everybody, while CRON_SECRET is unset —
 * gets 401: an unconfigured delete endpoint must never be an open one.
 */

import { NextResponse } from "next/server";
import { cronSecret } from "@/lib/env";
import { isCronAuthorized, retentionCutoff } from "@/lib/channels/retention";
import { purgeWhatsApp } from "@/lib/channels/store";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: Request): Promise<NextResponse> {
  if (!isCronAuthorized(request.headers.get("authorization"), cronSecret())) {
    return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE });
  }

  const before = retentionCutoff(new Date());
  const result = await purgeWhatsApp(before);
  if (!result.ok) {
    console.error(`[channels/retention] purge failed: ${result.error}`);
    return NextResponse.json({ ok: false, message: "The clean-up could not run." }, { status: 500, headers: NO_STORE });
  }

  // Counts only — never what was deleted.
  console.info(`[channels/retention] removed ${result.value} WhatsApp message(s) sent before ${before}`);
  return NextResponse.json({ ok: true, removed: result.value, before }, { headers: NO_STORE });
}
