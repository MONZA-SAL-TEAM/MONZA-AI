/**
 * GET /api/channels/retention — the daily WhatsApp housekeeping (Samer,
 * 2026-09-15; lib/channels/retention.ts):
 *
 *   1. keep files still waiting to be copied out of Meta, whose 7 days are
 *      running out (lib/channels/wa-media-store.ts);
 *   2. the 12-month rule: delete the FILES of messages older than twelve
 *      months, then the messages. When the files cannot be deleted the
 *      messages are kept for tomorrow — deleting them first would leave files
 *      behind with nothing pointing at them.
 *
 * Called by Vercel Cron (vercel.json), which sends `Authorization: Bearer
 * <CRON_SECRET>`. Anybody else — and everybody, while CRON_SECRET is unset —
 * gets 401: an unconfigured delete endpoint must never be an open one.
 */

import { NextResponse } from "next/server";
import { cronSecret } from "@/lib/env";
import { isCronAuthorized, retentionCutoff } from "@/lib/channels/retention";
import { purgeWhatsApp } from "@/lib/channels/store";
import { purgeWhatsAppMedia, sweepPendingMedia } from "@/lib/channels/wa-media-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" };
/** Time for copying waiting files, inside the route's 60 s. */
const SWEEP_BUDGET_MS = 25_000;

export async function GET(request: Request): Promise<NextResponse> {
  if (!isCronAuthorized(request.headers.get("authorization"), cronSecret())) {
    return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE });
  }

  const sweep = await sweepPendingMedia(SWEEP_BUDGET_MS);

  const before = retentionCutoff(new Date());
  const files = await purgeWhatsAppMedia(before);
  if (!files.ok) {
    console.error(`[channels/retention] old files could not be deleted: ${files.error}`);
    return NextResponse.json(
      { ok: false, message: "The clean-up could not delete old files; the messages are kept for tomorrow." },
      { status: 500, headers: NO_STORE }
    );
  }

  const result = await purgeWhatsApp(before);
  if (!result.ok) {
    console.error(`[channels/retention] purge failed: ${result.error}`);
    return NextResponse.json({ ok: false, message: "The clean-up could not run." }, { status: 500, headers: NO_STORE });
  }

  // Counts only — never what was deleted.
  console.info(
    `[channels/retention] removed ${result.value} WhatsApp message(s) and ${files.removed} file(s) sent before ${before}; ` +
      `kept ${sweep.saved} waiting file(s), ${sweep.left} still waiting`
  );
  return NextResponse.json(
    { ok: true, removed: result.value, files: files.removed, kept: sweep.saved, before },
    { headers: NO_STORE }
  );
}
