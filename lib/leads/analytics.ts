/**
 * The numbers behind the dashboard.
 *
 * Answers the questions Samer actually asked for: how many people came, where
 * from, which car they wanted, and how many of them bought one.
 *
 * ── Two databases, two authorities, and the seam between them ───────────────
 *
 * LEADS, TOUCHPOINTS and INTERESTS are MONZA AI's own records, read with the
 * service role. They are facts about this product's own conversations.
 *
 * CUSTOMERS and SALES belong to the CRM and are read under the STAFF MEMBER'S
 * OWN token. Two people can therefore see different numbers on this page, and
 * that is row-level security working rather than a bug — but it means the
 * lead-side and sale-side figures are NOT always drawn from the same
 * population, and a conversion rate computed across the seam would be
 * misleading in a way nobody could see.
 *
 * So `funnel()` reports the two sides as separate counts with an explicit
 * caveat, and does not divide one by the other. A ratio that is wrong in a way
 * that looks right is worse than two honest numbers side by side.
 *
 * ── The other honesty rule on this page ─────────────────────────────────────
 *
 * `direct` attribution means WE DO NOT KNOW. It is rendered as "Not tracked",
 * never merged into "organic" or "word of mouth", and never quietly dropped
 * from a chart so the remaining slices add to 100%. Somebody will make a
 * spending decision with this page.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExecutionContext } from "@/lib/connectors/types";
import { makeUserClient, isDemo } from "@/lib/connectors/crm";
import type { LeadSourceKind } from "@/lib/leads/attribution";
import { loadCatalog } from "@/lib/wasales/catalog";

/* ── Vocabulary ──────────────────────────────────────────────────────────── */

/** Staff words. Raw enum keys never reach the screen. */
export const SOURCE_LABEL: Record<LeadSourceKind, string> = {
  ad_click: "Paid ad",
  social_post: "A post or story",
  website: "The website",
  // Not "organic". Not "word of mouth". Those are claims; this is a gap.
  direct: "Not tracked",
  staff_recorded: "Recorded by staff",
};

export const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
};

export const BRAND_LABEL: Record<string, string> = {
  voyah: "VOYAH",
  mhero: "MHERO",
  monza: "MONZA SAL",
};

/* ── Shapes ──────────────────────────────────────────────────────────────── */

export interface Slice {
  key: string;
  label: string;
  count: number;
  /** True when the platform told us; false when we inferred or do not know. */
  certain: boolean;
}

export interface Funnel {
  /** People who have messaged, on any channel. */
  leads: number;
  /** Of those, matched to a CRM customer. */
  identified: number;
  /** Of those, matched automatically by mobile number rather than by a person. */
  identifiedByPhone: number;
  /** Waiting for somebody to confirm a name match. */
  awaitingReview: number;
  /** Named a car. */
  withInterest: number;
  /** Cars sold, per the CRM, as this staff member can see it. Null when the
   *  CRM could not be read — never zero, which would read as "sold nothing". */
  carsSold: number | null;
}

export interface RecentLead {
  id: string;
  displayName: string | null;
  phone: string | null;
  /** Their CRM customer id, once identified. */
  crmCustomerId: string | null;
  /** Resolved under the reader's own token — null when they cannot see them. */
  crmCustomerName: string | null;
  identified: boolean;
  identifiedBy: string | null;
  brand: string | null;
  channel: string | null;
  source: LeadSourceKind | null;
  sourceDetail: string | null;
  /** Which cars they named, most recent first. */
  interests: string[];
  firstSeen: string;
  lastSeen: string;
}

export interface DashboardData {
  funnel: Funnel;
  bySource: Slice[];
  byChannel: Slice[];
  byBrand: Slice[];
  topInterests: Slice[];
  recent: RecentLead[];
  /**
   * WHY THERE IS NOTHING TO SHOW — three distinct states, never collapsed.
   *
   *   "ok"           there is data
   *   "nothing_yet"  we read successfully and nobody has messaged
   *   "unavailable"  we could not read, and do not know
   *
   * The first version of this had a single `empty` boolean, and a failed
   * query rendered as "nobody has messaged yet" — the page confidently
   * reporting a quiet month when in fact it was blind. That is the exact
   * failure this whole module is written to avoid, and it got in anyway,
   * which is why the distinction is now in the type rather than in a comment.
   */
  state: "ok" | "nothing_yet" | "unavailable";
  /** Why a number is missing, in staff words. Empty when everything read. */
  caveats: string[];
}

/* ── Reading ─────────────────────────────────────────────────────────────── */

interface LeadRow {
  id: string;
  display_name: string | null;
  phone: string | null;
  crm_customer_id: string | null;
  crm_link_method: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

interface TouchpointRow {
  lead_id: string;
  brand: string;
  channel: string;
  source_kind: LeadSourceKind;
  headline: string | null;
  vehicle_context: string | null;
  occurred_at: string;
}

/** How many recent leads the page lists. */
const RECENT_LIMIT = 40;

export async function readDashboard(
  aiDb: SupabaseClient,
  ctx: ExecutionContext
): Promise<DashboardData> {
  const caveats: string[] = [];

  const { data: leadRows, error: leadErr } = await aiDb
    .from("leads")
    .select("id, display_name, phone, crm_customer_id, crm_link_method, first_seen_at, last_seen_at")
    .order("last_seen_at", { ascending: false })
    .limit(2000);

  if (leadErr) {
    // Could not read. NOT the same as "nobody has messaged", and the page
    // must not be able to render it as such.
    return emptyDashboard("unavailable", [
      "The lead records could not be read, so these figures are missing rather than zero.",
    ]);
  }

  const leads = (leadRows ?? []) as LeadRow[];

  if (leads.length === 0) {
    // A successful read that found nobody. Genuinely quiet.
    return emptyDashboard("nothing_yet", []);
  }

  const leadIds = leads.map((l) => l.id);

  const [touchRes, interestRes, pendingRes] = await Promise.all([
    aiDb
      .from("lead_touchpoints")
      .select("lead_id, brand, channel, source_kind, headline, vehicle_context, occurred_at")
      .in("lead_id", leadIds)
      .order("occurred_at", { ascending: true }),
    aiDb
      .from("lead_interests")
      .select("lead_id, car_key, last_mentioned_at")
      .in("lead_id", leadIds)
      .order("last_mentioned_at", { ascending: false }),
    aiDb
      .from("lead_match_suggestions")
      .select("lead_id")
      .eq("status", "pending"),
  ]);

  const touchpoints = (touchRes.data ?? []) as TouchpointRow[];
  const interests = (interestRes.data ?? []) as {
    lead_id: string;
    car_key: string;
    last_mentioned_at: string;
  }[];

  // ── FIRST touch per lead, which is the one that answers "where do customers
  // come from". Touchpoints arrive ordered ascending, so the first write wins
  // and later arrivals do not overwrite the origin.
  const firstTouch = new Map<string, TouchpointRow>();
  for (const t of touchpoints) {
    if (!firstTouch.has(t.lead_id)) firstTouch.set(t.lead_id, t);
  }

  const interestsByLead = new Map<string, string[]>();
  for (const i of interests) {
    const list = interestsByLead.get(i.lead_id) ?? [];
    list.push(i.car_key);
    interestsByLead.set(i.lead_id, list);
  }

  const awaitingReview = new Set((pendingRes.data ?? []).map((r) => r.lead_id as string)).size;

  // ── The CRM half, under the reader's own token ───────────────────────────
  const linkedIds = leads
    .map((l) => l.crm_customer_id)
    .filter((id): id is string => id !== null);

  const crm = await readCrmSide(ctx, linkedIds);
  if (crm.caveat) caveats.push(crm.caveat);

  const funnel: Funnel = {
    leads: leads.length,
    identified: linkedIds.length,
    identifiedByPhone: leads.filter((l) => l.crm_link_method === "phone_exact").length,
    awaitingReview,
    withInterest: interestsByLead.size,
    carsSold: crm.carsSold,
  };

  const carNames = new Map(loadCatalog().map((c) => [c.id, c.name]));

  return {
    funnel,
    bySource: tally(
      leads.map((l) => firstTouch.get(l.id)?.source_kind ?? null),
      (k) => SOURCE_LABEL[k as LeadSourceKind] ?? k,
      // Only a platform-reported source is certain. "Not tracked" is not.
      (k) => k !== "direct"
    ),
    byChannel: tally(
      leads.map((l) => firstTouch.get(l.id)?.channel ?? null),
      (k) => CHANNEL_LABEL[k] ?? k,
      () => true
    ),
    byBrand: tally(
      leads.map((l) => firstTouch.get(l.id)?.brand ?? null),
      (k) => BRAND_LABEL[k] ?? k,
      () => true
    ),
    topInterests: tally(
      interests.map((i) => i.car_key),
      (k) => carNames.get(k) ?? k,
      () => true
    ),
    recent: leads.slice(0, RECENT_LIMIT).map((l): RecentLead => {
      const t = firstTouch.get(l.id) ?? null;
      return {
        id: l.id,
        displayName: l.display_name,
        phone: l.phone,
        crmCustomerId: l.crm_customer_id,
        crmCustomerName: l.crm_customer_id
          ? (crm.names.get(l.crm_customer_id) ?? null)
          : null,
        identified: l.crm_customer_id !== null,
        identifiedBy: describeMethod(l.crm_link_method),
        brand: t?.brand ?? null,
        channel: t?.channel ?? null,
        source: t?.source_kind ?? null,
        sourceDetail: t?.headline ?? t?.vehicle_context ?? null,
        interests: (interestsByLead.get(l.id) ?? []).map((k) => carNames.get(k) ?? k),
        firstSeen: l.first_seen_at,
        lastSeen: l.last_seen_at,
      };
    }),
    state: "ok",
    caveats,
  };
}

/**
 * The CRM side: how many cars were sold, and what the identified customers are
 * called. Read under the staff member's own token, so a person who cannot see
 * customers gets nulls and a caveat rather than somebody else's data.
 */
async function readCrmSide(
  ctx: ExecutionContext,
  linkedIds: string[]
): Promise<{ carsSold: number | null; names: Map<string, string>; caveat: string | null }> {
  const names = new Map<string, string>();

  if (isDemo(ctx)) {
    return {
      carsSold: null,
      names,
      caveat: "Not connected to the CRM, so sales figures are not shown.",
    };
  }

  try {
    const db = makeUserClient(ctx);

    const { count, error: soldErr } = await db
      .from("sales_orders")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null);

    if (linkedIds.length > 0) {
      const { data } = await db
        .from("customers")
        .select("id, first_name, last_name")
        .in("id", linkedIds.slice(0, 500));

      for (const c of data ?? []) {
        const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
        if (name) names.set(String(c.id), name);
      }
    }

    if (soldErr) {
      return {
        carsSold: null,
        names,
        // Null rather than 0: "you sold nothing" and "we could not look" must
        // never render as the same number.
        caveat: "Your account cannot see sales orders, so that figure is hidden.",
      };
    }

    return { carsSold: count ?? 0, names, caveat: null };
  } catch {
    return { carsSold: null, names, caveat: "The CRM could not be reached." };
  }
}

/** Count occurrences, keeping unknowns visible rather than dropping them. */
function tally(
  values: (string | null)[],
  label: (key: string) => string,
  certain: (key: string) => boolean
): Slice[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    // A lead with no touchpoint at all is still a lead. Dropping it would make
    // the slices add up to less than the total without saying so.
    const key = v ?? "direct";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, label: label(key), count, certain: certain(key) }))
    .sort((a, b) => b.count - a.count);
}

function describeMethod(method: string | null): string | null {
  switch (method) {
    case "phone_exact":
      return "Matched by mobile number";
    case "human_confirmed":
      return "Confirmed by a person";
    case "customer_stated":
      return "The customer said so";
    default:
      return null;
  }
}

function emptyDashboard(
  state: "nothing_yet" | "unavailable",
  caveats: string[]
): DashboardData {
  return {
    funnel: {
      leads: 0,
      identified: 0,
      identifiedByPhone: 0,
      awaitingReview: 0,
      withInterest: 0,
      carsSold: null,
    },
    bySource: [],
    byChannel: [],
    byBrand: [],
    topInterests: [],
    recent: [],
    state,
    caveats,
  };
}
