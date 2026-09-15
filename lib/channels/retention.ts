/**
 * HOW LONG WHATSAPP MESSAGES ARE KEPT — 12 months (Samer, 2026-09-15).
 *
 * WhatsApp is the one channel MONZA AI stores (lib/channels/whatsapp.ts says
 * why), so it is the one channel that needs a limit. Vercel Cron calls
 * /api/channels/retention once a day; the route checks the caller with the
 * rule below and asks the database to delete everything older than the cutoff
 * (channel_purge_whatsapp, migration 009).
 *
 * SERVER ONLY: uses node:crypto.
 */

import { timingSafeEqual } from "node:crypto";

export const WHATSAPP_RETENTION_MONTHS = 12;

/** Everything sent before this instant is deleted. Pure: `now` is passed in. */
export function retentionCutoff(now: Date, months: number = WHATSAPP_RETENTION_MONTHS): string {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString();
}

/**
 * Is this the daily job calling? Vercel sends `Authorization: Bearer
 * <CRON_SECRET>`. No secret configured REFUSES — an unconfigured delete
 * endpoint must not be an open one — and so does a secret too short to be one.
 * Compared timing-safe.
 */
export function isCronAuthorized(header: string | null, secret: string | null): boolean {
  if (!secret || secret.length < 16 || !header) return false;
  const given = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
