/**
 * WHERE A LEAD CAME FROM — deciding what Meta's referral actually means.
 *
 * The adapter reported structure. This file assigns meaning, which is the line
 * CLAUDE.md draws between the two: an adapter that interprets is an adapter
 * that has to be rewritten for every business rule, and a business rule buried
 * in an adapter is one nobody can find.
 *
 * ── Why this is worth being careful about ───────────────────────────────────
 *
 * Meta attaches a referral to the FIRST message of a conversation and to no
 * other. There is no endpoint that returns it afterwards. If it is not read
 * and stored at the moment the webhook arrives, the answer to "did that
 * campaign sell anything" is gone permanently — and the only remaining way to
 * find out is to ask the customer, which is precisely what Samer asked this
 * system to make unnecessary.
 *
 * ── The honesty rule ────────────────────────────────────────────────────────
 *
 * `direct` means WE DO NOT KNOW. It is not a category of marketing, it is the
 * absence of evidence, and it must never be quietly folded into "organic" or
 * "word of mouth" on a dashboard. A number that says "42 leads from word of
 * mouth" when it means "42 leads we could not attribute" is worse than no
 * number, because somebody will make a budget decision with it.
 */

import type { InboundReferral } from "@/lib/channels/types";
import { matchModel, type WaCar } from "@/lib/wasales/matcher";

/** Mirrors public.lead_source_kind. */
export type LeadSourceKind =
  | "ad_click"
  | "social_post"
  | "website"
  | "direct"
  | "staff_recorded";

export interface AttributionResult {
  kind: LeadSourceKind;
  /** The ad, post or campaign reference — what identifies the spend. */
  ref: string | null;
  headline: string | null;
  /** Which vehicle the referring ad or page was about, in its own words. */
  vehicleContext: string | null;
  /**
   * Is this FACT or INFERENCE?
   *
   * True only when Meta named the source itself — a click id or an ad id. A
   * dashboard may present those as certainties and must hedge everything else,
   * so the distinction travels with the data rather than being remembered.
   */
  certain: boolean;
  /** One sentence a staff member can read. No jargon, no source codes. */
  explanation: string;
  raw: Record<string, unknown>;
}

/** Hosts that are ours. A referral from here is website traffic, not an ad. */
const OWN_HOSTS = [
  "monzasal.com",
  "voyahlebanon.com",
  "mherolebanon.com",
];

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function isOwnHost(url: string | null): boolean {
  const h = hostOf(url);
  return h !== null && OWN_HOSTS.some((own) => h === own || h.endsWith(`.${own}`));
}

/**
 * Classify one referral.
 *
 * Order matters and encodes how much each signal is worth:
 *
 *   1. A Click-to-WhatsApp click id. Meta minted it for one ad click. Fact.
 *   2. Meta calling the source an ad. Fact, slightly less specific.
 *   3. A story or post reference. Fact about which content, from Meta.
 *   4. A URL on one of our own sites. Fact about the page.
 *   5. Nothing. `direct`, meaning unknown, said plainly.
 */
export function classifyReferral(
  referral: InboundReferral | null | undefined
): AttributionResult {
  if (!referral) {
    return {
      kind: "direct",
      ref: null,
      headline: null,
      vehicleContext: null,
      certain: false,
      // Deliberately not "came directly" — that would assert something. They
      // had the handle already; how they got it is genuinely unknown.
      explanation: "Messaged the account directly — no ad or link to trace.",
      raw: {},
    };
  }

  const source = (referral.source ?? "").toLowerCase();

  // 1 & 2 — paid. The click id is the strongest signal in the system.
  if (referral.ctwaClid || source === "ads" || source === "ad") {
    return {
      kind: "ad_click",
      ref: referral.ctwaClid ?? referral.ref,
      headline: referral.headline,
      vehicleContext: referral.headline,
      certain: true,
      explanation: referral.headline
        ? `Clicked the ad "${referral.headline}".`
        : "Clicked one of your ads.",
      raw: referral.raw,
    };
  }

  // 3 — organic content. Meta named the story or post.
  if (referral.storyId || source === "story_reply" || source === "post") {
    return {
      kind: "social_post",
      ref: referral.storyId ?? referral.ref,
      headline: referral.headline,
      vehicleContext: referral.headline,
      certain: true,
      explanation: referral.storyId
        ? "Replied to one of your stories."
        : "Messaged from one of your posts.",
      raw: referral.raw,
    };
  }

  // 4 — our own website. The shortlink case lands here too when it carries a
  // URL; a SHORTLINK with no URL falls through to unknown, which is correct.
  if (isOwnHost(referral.sourceUrl)) {
    return {
      kind: "website",
      ref: referral.ref,
      headline: referral.headline,
      vehicleContext: vehicleFromUrl(referral.sourceUrl),
      certain: true,
      explanation: `Came from ${hostOf(referral.sourceUrl)}.`,
      raw: referral.raw,
    };
  }

  // 5 — Meta sent SOMETHING but nothing we can place. Keep the payload, admit
  // the gap. Inventing a category here is how attribution reports start lying.
  return {
    kind: "direct",
    ref: referral.ref,
    headline: referral.headline,
    vehicleContext: null,
    certain: false,
    explanation: "Arrived with a referral we could not identify.",
    raw: referral.raw,
  };
}

/* ── The website's own Ref code (owner, 17 Nov 2026) ─────────────────────── */

/**
 * Every WhatsApp button on the three websites ends the pre-filled message with
 * "(Ref V-7K2Q9M)": V = voyahlebanon.com, M = mherolebanon.com, S = monzasal.com,
 * six letters/digits with no 0, O, 1 or I. The website records the same code with
 * the visit in the Monza CRM (website_events, CRM migration 333), so a chat that
 * starts with it can be traced back to that visit — its page, Google or
 * Instagram, the campaign — by reading the CRM AS THE PERSON LOOKING. Nothing
 * here writes to the CRM.
 *
 * The code is OURS, written by our website, not the customer's words: keeping it
 * keeps no customer text. Only an exact code is believed — a customer who types
 * "ref" or a different code is simply not a website arrival.
 */
export const WEBSITE_REF = /\(Ref ([VMS])-([A-HJ-NP-Z2-9]{6})\)/;

export const WEBSITE_OF_LETTER: Readonly<Record<string, string>> = {
  V: "voyahlebanon.com",
  M: "mherolebanon.com",
  S: "monzasal.com",
};

/** The first-touch key the insights use for a website arrival, by site. */
export const WEBSITE_TOUCH_OF_LETTER: Readonly<Record<string, string>> = {
  V: "website_voyah",
  M: "website_mhero",
  S: "website_monza",
};

/** The Ref code in a message, or null. */
export function websiteRefIn(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = WEBSITE_REF.exec(text);
  return m ? `${m[1]}-${m[2]}` : null;
}

/** "website_voyah" etc. for a stored Ref code; "website" for any other website touchpoint. */
export function websiteTouchKey(sourceRef: string | null | undefined): string {
  const letter = typeof sourceRef === "string" && /^[VMS]-[A-HJ-NP-Z2-9]{6}$/.test(sourceRef) ? sourceRef[0] : null;
  return letter ? WEBSITE_TOUCH_OF_LETTER[letter] : "website";
}

/**
 * Where an arrival came from: Meta's referral first (an ad or a post is fact,
 * and Meta only attaches it to the first message), then the website's Ref
 * code, then — honestly — unknown.
 */
export function classifyArrival(
  referral: InboundReferral | null | undefined,
  text: string | null | undefined
): AttributionResult {
  const fromMeta = classifyReferral(referral);
  if (fromMeta.kind !== "direct") return fromMeta;
  const code = websiteRefIn(text);
  if (!code) return fromMeta;
  const site = WEBSITE_OF_LETTER[code[0]];
  return {
    kind: "website",
    ref: code,
    headline: site,
    vehicleContext: null,
    certain: true,
    explanation: `Tapped WhatsApp on ${site} (Ref ${code}).`,
    raw: { ref_code: code, site },
  };
}

/**
 * The vehicle a website URL was about, from its path.
 *
 * monzasal.com puts the model in the path (/voyah-free, /models/mhero-1). This
 * reads it as WORDS, and resolving those words to a catalogue model is
 * `interestFromText`'s job below — one matcher, not two, or the website and
 * the chat would disagree about what a car is called.
 */
function vehicleFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const path = new URL(url).pathname;
    const words = path
      .split("/")
      .filter(Boolean)
      .join(" ")
      .replace(/[-_]+/g, " ")
      .trim();
    return words || null;
  } catch {
    return null;
  }
}

/* ── What car are they actually asking about ─────────────────────────────── */

export interface DetectedInterest {
  carKey: string;
  carName: string;
  /** The words in the message that identified it. */
  rawMention: string;
  confidence: "exact" | "fuzzy";
}

/**
 * Which model did this message name?
 *
 * Reuses `matchModel` — the SAME matcher the sales auto-responder uses to
 * decide whether to send a brochure. That sharing is deliberate and load
 * bearing: if the dashboard counted interest with its own matcher, "36 people
 * asked about the MHERO 1" and "we auto-replied to 22 MHERO enquiries" would
 * be measuring different things, and nobody could say which was wrong.
 *
 * Returns null when the matcher held rather than matched — including when two
 * models both matched. An ambiguous mention is not evidence of interest in
 * either, and recording both would inflate every count on the dashboard.
 */
export function interestFromText(
  text: string,
  catalog: readonly WaCar[]
): DetectedInterest | null {
  if (!text.trim()) return null;

  const m = matchModel(text, catalog);
  if (m.decision !== "send" || !m.model) return null;

  return {
    carKey: m.model.id,
    carName: m.model.name,
    rawMention: m.matchedText ?? text.slice(0, 120),
    confidence: m.confidence ?? "fuzzy",
  };
}

/**
 * The one line a staff member reads on a customer's card.
 *
 * Written here rather than in the UI so the dashboard, the inbox and the
 * customer page cannot describe the same touchpoint three different ways.
 */
export function describeAttribution(a: AttributionResult): string {
  if (!a.certain) return a.explanation;
  const vehicle = a.vehicleContext ? ` (about ${a.vehicleContext})` : "";
  return `${a.explanation}${vehicle}`;
}
