/**
 * OUR OWN REPLIES ON INSTAGRAM AND FACEBOOK, AS TURNS — WHEN, NEVER WHAT (Samer, 2026-11-25).
 *
 * Meta plays our outgoing messages back to the webhook as "echoes" (`message.is_echo`), including
 * the ones a person typed in the Instagram app or Meta Business Suite. The adapters drop them
 * (CLAUDE.md rule 19: stored as a message, an echo would double every reply in its own thread) —
 * and so MONZA AI could not tell an answered Instagram chat from an ignored one: 132 open alerts
 * were "unverified" on the day this was written, and 371 of the 716 Instagram deliveries ever
 * received had been read as nothing.
 *
 * An echo is still not stored as a message, and its words are still never read. What is kept is
 * the TURN: this account wrote to this customer at this time (`channel_turns`, source "echo") —
 * which is exactly what "has a person answered?" needs. Pure: payload in, turns out.
 *
 * `messaging_seen`, reactions and postbacks are not echoes and are not turns.
 */

import type { ChannelAccount } from "@/lib/channels/types";

export interface EchoTurn {
  accountId: string;
  channel: "instagram" | "facebook";
  /** The customer the message was sent TO. */
  peerExternalId: string;
  externalMessageId: string;
  at: string;
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);

function isoFrom(timestamp: unknown, fallback: string): string {
  const n = typeof timestamp === "number" ? timestamp : Number(timestamp);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  // Meta sends milliseconds on these objects; a seconds value is still read correctly.
  const ms = n < 1e12 ? n * 1000 : n;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
}

export function parseMetaEchoes(body: unknown, accounts: readonly ChannelAccount[], receivedAt = new Date().toISOString()): EchoTurn[] {
  const root = obj(body);
  const object = str(root?.object);
  const channel = object === "instagram" ? "instagram" : object === "page" ? "facebook" : null;
  if (!root || !channel) return [];
  const out: EchoTurn[] = [];
  for (const rawEntry of Array.isArray(root.entry) ? root.entry : []) {
    const entry = obj(rawEntry);
    const accountExternalId = str(entry?.id);
    // The account is the one Meta delivered to — never guessed from the payload's words (rule 1).
    const account = accountExternalId ? accounts.find((a) => a.channel === channel && a.externalId === accountExternalId) : undefined;
    if (!entry || !account) continue;
    for (const rawEvent of Array.isArray(entry.messaging) ? entry.messaging : []) {
      const event = obj(rawEvent);
      const message = obj(event?.message);
      if (!event || !message || message.is_echo !== true) continue;
      const mid = str(message.mid);
      const to = str(obj(event.recipient)?.id);
      // An echo is sent BY the account TO a customer; anything else is not one of ours to count.
      if (!mid || !to || to === accountExternalId || !/^\d{3,40}$/.test(to)) continue;
      out.push({ accountId: account.id, channel, peerExternalId: to, externalMessageId: mid.slice(0, 200), at: isoFrom(event.timestamp, receivedAt) });
    }
  }
  return out;
}

/**
 * What each `messaging` event of a delivery WAS, for the delivery record — Meta's own structure,
 * never a person's words. So "what are the Instagram deliveries we read as nothing?" has an answer.
 */
export function messagingKinds(entry: Record<string, unknown> | null): string[] {
  const events = Array.isArray(entry?.messaging) ? (entry!.messaging as unknown[]) : [];
  return events.map((raw) => {
    const e = obj(raw);
    const m = obj(e?.message);
    if (m) return m.is_echo === true ? "echo" : m.is_deleted === true ? "deleted" : m.is_unsupported === true ? "unsupported" : "message";
    if (e?.postback) return "postback";
    if (e?.read) return "read";
    if (e?.reaction) return "reaction";
    if (e?.referral) return "referral";
    return "other";
  });
}
