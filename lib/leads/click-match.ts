/**
 * Did this WhatsApp chat start from a tap on one of our websites?
 *
 * Pure, and NOT wired to anything yet: nothing calls it, nothing is stored.
 * See "What is missing" at the foot of this header before using it.
 *
 * ── Why timing, and what it is worth ────────────────────────────────────────
 *
 * The websites' WhatsApp buttons add no reference to the customer's message
 * (the owner's rule: a customer never sees a tracking code). So a chat that
 * came from the site arrives looking exactly like one typed from memory, and
 * is filed `direct` — "we do not know".
 *
 * What we DO have is two clocks: the site records when a WhatsApp button was
 * tapped, and the webhook records when a first message arrived. Measured on
 * the live data of 17 Sep – 27 Nov 2026: of 233 distinct taps, 100 were
 * followed within five minutes by a first message from a new number, where
 * chance alone would give about one. That is strong evidence for the group
 * and never proof for one person — two people can tap and write in the same
 * minute. So the result of this file is an INFERENCE and says so in every
 * field: `certain` is always false.
 *
 * ── The rules, each one a refusal ───────────────────────────────────────────
 *
 * - Only a chat whose first touch is `direct` is considered. A chat Meta
 *   attributed to an ad, a post or a story keeps that source: this never
 *   overwrites what is known with what is guessed. (32 ad chats in the same
 *   period also followed a site tap; they stay ad chats.)
 * - One tap explains at most one chat, and one chat is explained by at most
 *   one tap. Taps by the same visitor within two minutes are one tap.
 * - The message must come AFTER the tap, and within the window.
 * - When two chats could claim the same tap, the earlier one has it and the
 *   other stays "not tracked". Guessing which is how a report starts lying.
 *
 * ── What is missing before this can be used ─────────────────────────────────
 *
 * 1. The taps live in the CRM project (`website_events`), which MONZA AI may
 *    read only as a signed-in person. No function there returns tap times to
 *    staff today; one has to be added (times, site and car only — no visitor).
 * 2. A place to keep the answer that cannot be mistaken for a certainty. The
 *    `website` source kind today means "Meta named our site" (certain). An
 *    inferred touch needs its own label on every screen that shows a source.
 */

import type { LeadSourceKind } from "@/lib/leads/attribution";

/** A WhatsApp button tapped on one of the sites. Times are epoch milliseconds. */
export interface SiteTap {
  at: number;
  /** The site's host, e.g. "voyahlebanon.com". */
  site: string;
  /** The car on screen, as the site named it. Never a visitor's identity. */
  vehicle: string | null;
  /** The site's own per-tab visit id, when it sent one. */
  sessionId?: string | null;
}

/** The first message of a WhatsApp chat. */
export interface FirstMessage {
  leadId: string;
  at: number;
  /** What the lead's first touch says today. */
  firstTouch: LeadSourceKind;
}

export interface InferredWebsiteTouch {
  leadId: string;
  site: string;
  vehicle: string | null;
  tapAt: number;
  /** Seconds between the tap and the first message. */
  gapSeconds: number;
  /** Always false. Present so no caller can forget to hedge. */
  certain: false;
  /** One sentence a staff member can read. */
  explanation: string;
}

/** A first message later than this after the tap is not attributed to it. */
export const TAP_WINDOW_MS = 5 * 60 * 1000;
/** Taps closer together than this, on one site, are one visitor tapping again. */
export const TAP_MERGE_MS = 2 * 60 * 1000;

interface TapGroup {
  first: number;
  last: number;
  site: string;
  vehicle: string | null;
  sessionId: string | null;
}

/**
 * Collapse repeated taps: same site, same visit id (or neither tap carrying
 * one), and no more than two minutes after the previous tap of that group.
 */
export function mergeTaps(taps: readonly SiteTap[]): TapGroup[] {
  const sorted = [...taps].filter((t) => Number.isFinite(t.at)).sort((a, b) => a.at - b.at);
  const groups: TapGroup[] = [];
  for (const t of sorted) {
    const sid = t.sessionId ?? null;
    const prev = [...groups].reverse().find((g) => g.site === t.site && (sid !== null ? g.sessionId === sid : g.sessionId === null));
    if (prev && t.at - prev.last <= TAP_MERGE_MS) {
      prev.last = t.at;
      // The car on screen at the LAST tap is the one they were asking about.
      if (t.vehicle) prev.vehicle = t.vehicle;
      continue;
    }
    groups.push({ first: t.at, last: t.at, site: t.site, vehicle: t.vehicle, sessionId: sid });
  }
  return groups;
}

/**
 * Which `direct` WhatsApp chats most likely began with a tap on a site.
 *
 * Returns at most one result per chat and uses each tap at most once.
 */
export function inferWebsiteTouches(
  messages: readonly FirstMessage[],
  taps: readonly SiteTap[],
  windowMs: number = TAP_WINDOW_MS
): InferredWebsiteTouch[] {
  const groups = mergeTaps(taps);
  const used = new Set<TapGroup>();
  const out: InferredWebsiteTouch[] = [];

  // Earliest message first: when two chats could claim one tap, the earlier has it.
  const candidates = messages.filter((m) => m.firstTouch === "direct" && Number.isFinite(m.at)).sort((a, b) => a.at - b.at);

  for (const m of candidates) {
    let best: TapGroup | null = null;
    for (const g of groups) {
      if (used.has(g)) continue;
      // The message must follow the tap. Equal times are allowed: both clocks are to the second.
      if (g.first > m.at) break;
      if (m.at - g.last > windowMs) continue;
      // The latest eligible tap is the closest one.
      best = g;
    }
    if (!best) continue;
    used.add(best);
    const gapSeconds = Math.max(0, Math.round((m.at - best.last) / 1000));
    out.push({
      leadId: m.leadId,
      site: best.site,
      vehicle: best.vehicle,
      tapAt: best.last,
      gapSeconds,
      certain: false,
      explanation: `Wrote ${gapSeconds < 60 ? "under a minute" : `${Math.round(gapSeconds / 60)} min`} after a WhatsApp button was tapped on ${best.site}. Likely from the website; not certain.`,
    });
  }
  return out;
}
