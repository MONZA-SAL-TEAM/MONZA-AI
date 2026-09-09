/**
 * Matching a lead to a CRM customer — the half that needs a staff member.
 *
 * ── Why this is not in store.ts ─────────────────────────────────────────────
 *
 * Because it reads the CRM, and every CRM read in this product happens under
 * the SIGNED-IN STAFF MEMBER'S OWN token. There is no service-role path into
 * the customer database and there must never be one: it is the guarantee that
 * makes "the AI physically cannot read what you cannot read" true rather than
 * aspirational.
 *
 * A webhook has no user, so it cannot do this. It captures the perishable half
 * — the attribution, which Meta hands over once and never again — and leaves
 * the identification to the moment somebody with CRM access is actually
 * looking. See the header of lib/leads/store.ts.
 *
 * ── The consequence, stated so nobody is surprised by it ────────────────────
 *
 * Two staff members can see DIFFERENT match suggestions for the same lead, if
 * the CRM shows them different customers. That is not a bug to be smoothed
 * over; it is row-level security working. What must never happen is one staff
 * member's view LEAKING to another, which is why the candidate list is fetched
 * per request and never cached.
 *
 * ── And the rule this file exists to enforce ────────────────────────────────
 *
 * A phone match links. A name match waits for a click. `decide()` in
 * matching.ts is the only thing that chooses between them, the database
 * refuses a name-based link independently, and this file just carries out the
 * verdict — three layers, so an error in any one of them is caught by another.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExecutionContext } from "@/lib/connectors/types";
import { makeUserClient, isDemo } from "@/lib/connectors/crm";
import { decide, type MatchCandidate, type MatchSubject } from "@/lib/leads/matching";
import { normalizeLebanesePhone } from "@/lib/leads/phone";

export interface ResolveOutcome {
  leadId: string;
  /** What happened, in one word, for a caller that wants to count. */
  result: "linked" | "suggested" | "nothing" | "already_linked" | "unavailable";
  crmCustomerId?: string;
  suggestionCount?: number;
  /** One sentence for a staff member. Never a stack trace, never a table name. */
  detail: string;
}

/**
 * How many CRM customers to weigh against one lead.
 *
 * The CRM's customer list is small today (single figures) and will not be
 * large for years — Monza sells cars, not subscriptions. Pulling the visible
 * set and matching in memory is therefore both simplest and exact, and avoids
 * asking Postgres for a fuzzy name search whose behaviour we would then have
 * to keep in step with the matcher's.
 *
 * If this ever stops being true the fix is a phone-indexed lookup first and a
 * name search second, NOT a bigger limit — a matcher that silently sees only
 * the first thousand customers is a matcher that silently stops finding people.
 */
const CANDIDATE_LIMIT = 2000;

/**
 * Try to identify one lead.
 *
 * `aiDb` writes the verdict (service role, MONZA AI's own tables). `ctx`
 * carries the staff member's CRM token and is the ONLY thing that reads a
 * customer. The two clients are separate arguments rather than one connection
 * precisely so that cannot be confused.
 */
export async function resolveLead(
  aiDb: SupabaseClient,
  ctx: ExecutionContext,
  leadId: string
): Promise<ResolveOutcome> {
  // Demo mode has no CRM to match against, and inventing a link would put a
  // fake customer name on a real conversation.
  if (isDemo(ctx)) {
    return {
      leadId,
      result: "unavailable",
      detail: "Not connected to the CRM, so nobody can be identified yet.",
    };
  }

  const lead = await aiDb
    .from("leads")
    .select("id, display_name, phone, crm_customer_id")
    .eq("id", leadId)
    .maybeSingle();

  if (lead.error || !lead.data) {
    return { leadId, result: "unavailable", detail: "That lead no longer exists." };
  }

  // Already settled. Re-matching an identified lead could only ever overwrite
  // a human's decision with a guess.
  if (lead.data.crm_customer_id) {
    return {
      leadId,
      result: "already_linked",
      crmCustomerId: lead.data.crm_customer_id,
      detail: "Already matched to a customer.",
    };
  }

  const candidates = await fetchCandidates(ctx);
  if (candidates === null) {
    return {
      leadId,
      result: "unavailable",
      detail: "Your account cannot read the customer list, so no match was attempted.",
    };
  }

  const subject: MatchSubject = {
    displayName: lead.data.display_name,
    phone: lead.data.phone,
  };

  const verdict = decide(subject, candidates);

  if (verdict.kind === "link") {
    const { error } = await aiDb
      .from("leads")
      .update({
        crm_customer_id: verdict.crmCustomerId,
        crm_link_method: verdict.method,
        crm_link_confidence: verdict.confidence,
        // Null confirmer, because no person confirmed it — the phone number
        // did. Recorded honestly so an audit can tell the two apart.
        crm_link_confirmed_by: null,
        crm_link_confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", leadId)
      // Only if still unlinked: a staff member may have decided between our
      // read above and this write, and their decision wins.
      .is("crm_customer_id", null);

    if (error) {
      return { leadId, result: "unavailable", detail: "The match could not be saved." };
    }
    return {
      leadId,
      result: "linked",
      crmCustomerId: verdict.crmCustomerId,
      detail: "Matched by mobile number.",
    };
  }

  if (verdict.kind === "suggest") {
    const rows = verdict.suggestions.map((s) => ({
      lead_id: leadId,
      crm_customer_id: s.crmCustomerId,
      crm_customer_name: s.crmCustomerName,
      method: s.method,
      score: s.score,
      evidence: s.evidence,
    }));

    // Never overwrite an existing row: a REJECTED suggestion must stay
    // rejected. Re-proposing a match a person already turned down teaches
    // staff to ignore the queue, and an ignored queue looks like work being
    // done while none is.
    const { error } = await aiDb
      .from("lead_match_suggestions")
      .upsert(rows, { onConflict: "lead_id,crm_customer_id", ignoreDuplicates: true });

    if (error) {
      return { leadId, result: "unavailable", detail: "The suggestions could not be saved." };
    }
    return {
      leadId,
      result: "suggested",
      suggestionCount: rows.length,
      detail:
        rows.length === 1
          ? "One possible customer found — needs a person to confirm."
          : `${rows.length} possible customers found — need a person to confirm.`,
    };
  }

  return {
    leadId,
    result: "nothing",
    detail: "No customer in the CRM looks like this person.",
  };
}

/**
 * The customers this staff member can see, as match candidates.
 *
 * Returns null when the CRM refused — which is a normal outcome, not an error:
 * a marketing employee may legitimately have no customer access, and the right
 * answer is "no match attempted", never a match made with somebody else's
 * privileges.
 */
async function fetchCandidates(ctx: ExecutionContext): Promise<MatchCandidate[] | null> {
  try {
    const db = makeUserClient(ctx);
    const { data, error } = await db
      .from("customers")
      .select("id, first_name, last_name, phone_primary, phone_secondary")
      .is("deleted_at", null)
      .limit(CANDIDATE_LIMIT);

    if (error) return null;

    return (data ?? []).map((c: Record<string, unknown>) => ({
      crmCustomerId: String(c.id),
      name: [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || null,
      // Both numbers. A customer who gave a second number and writes from it
      // is still that customer, and only checking the primary would miss them.
      phones: [c.phone_primary as string | null, c.phone_secondary as string | null],
    }));
  } catch {
    return null;
  }
}

/**
 * A person clicked "yes, this is them".
 *
 * The ONLY way a name-based match becomes a link, and the method recorded is
 * `human_confirmed` rather than `name_similar` — because what is now known is
 * not that the names were alike but that somebody who can tell said so. The
 * database would refuse the other spelling anyway.
 */
export async function acceptSuggestion(
  aiDb: SupabaseClient,
  suggestionId: string,
  staffId: string
): Promise<ResolveOutcome> {
  const s = await aiDb
    .from("lead_match_suggestions")
    .select("id, lead_id, crm_customer_id, status")
    .eq("id", suggestionId)
    .maybeSingle();

  if (s.error || !s.data) {
    return { leadId: "", result: "unavailable", detail: "That suggestion no longer exists." };
  }
  if (s.data.status !== "pending") {
    return {
      leadId: s.data.lead_id,
      result: "unavailable",
      detail: "Somebody has already decided this one.",
    };
  }

  const now = new Date().toISOString();

  const { error } = await aiDb
    .from("leads")
    .update({
      crm_customer_id: s.data.crm_customer_id,
      crm_link_method: "human_confirmed",
      crm_link_confidence: 1,
      crm_link_confirmed_by: staffId,
      crm_link_confirmed_at: now,
      updated_at: now,
    })
    .eq("id", s.data.lead_id);

  if (error) {
    return { leadId: s.data.lead_id, result: "unavailable", detail: "The match could not be saved." };
  }

  await aiDb
    .from("lead_match_suggestions")
    .update({ status: "accepted", decided_by: staffId, decided_at: now })
    .eq("id", suggestionId);

  // Every OTHER pending suggestion for this lead is now wrong by construction:
  // the person has been identified, so the alternatives are not merely
  // unchosen, they are incorrect. Leaving them pending would put a decided
  // lead back in the queue tomorrow.
  await aiDb
    .from("lead_match_suggestions")
    .update({ status: "rejected", decided_by: staffId, decided_at: now })
    .eq("lead_id", s.data.lead_id)
    .eq("status", "pending");

  return {
    leadId: s.data.lead_id,
    result: "linked",
    crmCustomerId: s.data.crm_customer_id,
    detail: "Matched, confirmed by a person.",
  };
}

/** A person said no. Remembered, so it is never offered again. */
export async function rejectSuggestion(
  aiDb: SupabaseClient,
  suggestionId: string,
  staffId: string
): Promise<void> {
  await aiDb
    .from("lead_match_suggestions")
    .update({
      status: "rejected",
      decided_by: staffId,
      decided_at: new Date().toISOString(),
    })
    .eq("id", suggestionId)
    .eq("status", "pending");
}

/**
 * A staff member typed a phone number onto a lead that had none.
 *
 * Runs the number through the same normaliser as everything else, so a number
 * typed by hand and a number sent by WhatsApp become the same string and the
 * cross-channel join works from either direction.
 */
export function normalizeStaffEnteredPhone(input: string): string | null {
  return normalizeLebanesePhone(input);
}
