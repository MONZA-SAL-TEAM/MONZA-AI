/**
 * Keeping the link between a chat lead and its CRM customer — SERVER ONLY.
 *
 * ── Who is acting ───────────────────────────────────────────────────────────
 *
 * The CRM customers handed in were read by the SIGNED-IN staff member, with
 * their own CRM token (lib/leads/people-crm.ts). This file never reads the CRM
 * and holds no key to it; it only writes MONZA AI's own `leads` rows, and only
 * the CRM customer's id — never a name, a car or a figure. So the rule in
 * lib/leads/resolve.ts holds: a lead is identified when somebody with CRM
 * access is looking, not by a background job with a master key.
 *
 * ── Off unless switched on ──────────────────────────────────────────────────
 *
 * Nothing is written unless LEAD_LINK_MODE is exactly "apply" (lib/env.ts).
 * Unset, it plans and counts and changes nothing — the same shape as
 * CHANNELS_SEND_MODE and ALERT_RECONCILE_MODE.
 *
 * Every write is conditional on the lead still being unlinked, so two people
 * opening /customers at once link each lead once, and a person's own decision
 * made in between is never overwritten.
 */

import { channelDb } from "@/lib/channels/store";
import { leadLinkApplies } from "@/lib/env";
import { planPhoneLinks, type LinkCustomer, type LinkLead } from "@/lib/leads/link";

const PAGE = 1000;
const MAX = 20_000;
/** This runs inside a page view: it may not make the page wait. */
const BUDGET_MS = 4_000;
const BATCH = 20;

export interface LinkOutcome {
  /** Did this run write? False in report-only mode. */
  applied: boolean;
  toLink: number;
  linked: number;
  sharedNumber: number;
  /** True when the time budget ran out; the next page view carries on. */
  partial: boolean;
}

/**
 * Plan, and when switched on, keep the phone links. Null when MONZA AI's own
 * database cannot be read here — the caller then says nothing, never "0".
 */
export async function linkLeadsByPhone(customers: readonly LinkCustomer[]): Promise<LinkOutcome | null> {
  const sb = channelDb();
  if (!sb) return null;

  const leads: LinkLead[] = [];
  for (let from = 0; from < MAX; from += PAGE) {
    const { data, error } = await sb.from("leads").select("id, phone, crm_customer_id").order("id").range(from, from + PAGE - 1);
    if (error) return null;
    const rows = (data ?? []) as { id: string; phone: string | null; crm_customer_id: string | null }[];
    for (const r of rows) leads.push({ id: r.id, phone: r.phone, crmCustomerId: r.crm_customer_id });
    if (rows.length < PAGE) break;
  }

  const plan = planPhoneLinks(leads, customers);
  const outcome: LinkOutcome = { applied: false, toLink: plan.counts.toLink, linked: 0, sharedNumber: plan.counts.sharedNumber, partial: false };
  if (!leadLinkApplies() || plan.links.length === 0) return outcome;

  outcome.applied = true;
  const started = Date.now();
  const now = new Date().toISOString();
  for (let i = 0; i < plan.links.length; i += BATCH) {
    if (Date.now() - started > BUDGET_MS) {
      outcome.partial = true;
      break;
    }
    const results = await Promise.all(
      plan.links.slice(i, i + BATCH).map((l) =>
        sb
          .from("leads")
          .update({
            crm_customer_id: l.crmCustomerId,
            crm_link_method: "phone_exact",
            crm_link_confidence: 1,
            // No person confirmed it — the number did. Same honesty as resolve.ts.
            crm_link_confirmed_by: null,
            crm_link_confirmed_at: now,
            updated_at: now,
          })
          .eq("id", l.leadId)
          // Only if still unlinked: a person's decision made meanwhile wins.
          .is("crm_customer_id", null)
          .select("id")
      )
    );
    for (const r of results) if (!r.error && Array.isArray(r.data)) outcome.linked += r.data.length;
  }
  return outcome;
}
