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
 * - Taps by the same visitor within two minutes are one tap.
 * - The message must come AFTER the tap, and within the window.
 * - NEVER FORCED. A chat is attributed only when exactly one tap could explain
 *   it AND it is the only first message that tap could explain. Two taps before
 *   one chat, or two chats after one tap, attribute nobody: all of them stay
 *   "not tracked". An ad chat counts as a claimant too — it may be the one the
 *   tap led to — even though it is never itself relabelled.
 * - The car is a second witness. When the page's car and the car the customer
 *   asks about clearly differ, the chat is not attributed.
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
  /** Car keys the customer has asked about (`lead_interests.car_key`), if known. */
  interests?: readonly string[];
}

export interface InferredWebsiteTouch {
  leadId: string;
  site: string;
  vehicle: string | null;
  tapAt: number;
  /** Seconds between the tap and the first message. */
  gapSeconds: number;
  /**
   * Does the car on the page agree with the car the customer asked about?
   * "unknown" when either side names no particular car. Never "differs":
   * those chats are not attributed at all.
   */
  car: "matches" | "unknown";
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

/** Words that name a marque or a variant, not a particular car. */
const NOT_A_MODEL = new Set(["voyah", "monza", "sal", "comp", "lebanon"]);

/**
 * Reduce a car's name to something comparable: "VOYAH Courage" and the key
 * "voyah-courage" both become "courage"; "MHERO 1" and "mhero-1" both become
 * "mhero 1". Null when no particular car is named ("VOYAH", "MHERO", "Monza").
 */
export function carWord(name: string | null | undefined): string | null {
  if (!name) return null;
  const tokens = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter((t) => t && !NOT_A_MODEL.has(t));
  if (tokens.length === 0) return null;
  // MHERO is marque and model at once: the number is the car.
  if (tokens[0] === "mhero") return tokens.length > 1 ? `mhero ${tokens[1]}` : null;
  return tokens[0];
}

/** Does the page's car agree with what the customer asked about? */
export function carAgreement(pageVehicle: string | null, interests: readonly string[] | undefined): "matches" | "differs" | "unknown" {
  const page = carWord(pageVehicle);
  const asked = (interests ?? []).map(carWord).filter((x): x is string => x !== null);
  if (page === null || asked.length === 0) return "unknown";
  return asked.includes(page) ? "matches" : "differs";
}

/**
 * Which `direct` WhatsApp chats most likely began with a tap on a site.
 *
 * `messages` must hold EVERY first WhatsApp message of the period, whatever its
 * source: an ad chat is never relabelled, but it competes for a tap.
 */
export function inferWebsiteTouches(
  messages: readonly FirstMessage[],
  taps: readonly SiteTap[],
  windowMs: number = TAP_WINDOW_MS
): InferredWebsiteTouch[] {
  const groups = mergeTaps(taps);
  const all = messages.filter((m) => Number.isFinite(m.at));

  const explains = (g: TapGroup, m: FirstMessage) => g.first <= m.at && m.at - g.last <= windowMs;

  // How many first messages each tap could explain — of any source.
  const claimants = new Map<TapGroup, number>();
  for (const g of groups) claimants.set(g, all.filter((m) => explains(g, m)).length);

  const out: InferredWebsiteTouch[] = [];
  for (const m of all) {
    if (m.firstTouch !== "direct") continue;
    const candidates = groups.filter((g) => explains(g, m));
    // Two taps could explain it: we cannot say which, so we say nothing.
    if (candidates.length !== 1) continue;
    const tap = candidates[0];
    // Another chat could claim this tap: same refusal.
    if ((claimants.get(tap) ?? 0) !== 1) continue;
    const car = carAgreement(tap.vehicle, m.interests);
    // The page showed one car and they asked about another: not this tap's chat.
    if (car === "differs") continue;

    const gapSeconds = Math.max(0, Math.round((m.at - tap.last) / 1000));
    out.push({
      leadId: m.leadId,
      site: tap.site,
      vehicle: tap.vehicle,
      tapAt: tap.last,
      gapSeconds,
      car,
      certain: false,
      explanation:
        `Wrote ${gapSeconds < 60 ? "under a minute" : `${Math.round(gapSeconds / 60)} min`} after a WhatsApp button was tapped on ${tap.site}` +
        `${car === "matches" ? ", about the car that page showed" : ""}. Likely from the website; not certain.`,
    });
  }
  return out.sort((a, b) => a.tapAt - b.tapAt);
}

export interface WindowRow {
  minutes: number;
  /** Chats attributed at this window. */
  inferred: number;
  /**
   * The same count with every tap moved six hours later — what coincidence
   * alone produces. A window is only as good as the gap between the two.
   */
  byChance: number;
}

/** Compare windows on the same data, so the choice of five minutes can be checked, not trusted. */
export function windowReport(messages: readonly FirstMessage[], taps: readonly SiteTap[], minutes: readonly number[] = [1, 3, 5, 10]): WindowRow[] {
  const shifted = taps.map((t) => ({ ...t, at: t.at + 6 * 60 * 60 * 1000 }));
  return minutes.map((m) => ({
    minutes: m,
    inferred: inferWebsiteTouches(messages, taps, m * 60_000).length,
    byChance: inferWebsiteTouches(messages, shifted, m * 60_000).length,
  }));
}
