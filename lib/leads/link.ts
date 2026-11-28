/**
 * Which chat leads are the CRM's customers — by mobile number, and by nothing else.
 *
 * Pure. Leads and customers go in, a plan comes out; nothing here reads a
 * database, so every rule below is a fixture in tests/leads-link.test.ts.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * /customers already shows a chat beside its CRM customer for one page view
 * (`mergeCrm`), and nothing kept that answer. So the question "did this chat
 * become a sale?" could never be asked later: on 2026-11-28, 0 of 1,784 leads
 * carried a CRM customer. This plans the links that are safe to keep.
 *
 * ── The rules, each one a refusal ───────────────────────────────────────────
 *
 * - A Lebanese MOBILE links; a landline never does (lib/leads/phone.ts
 *   `isAutoLinkable`) — a household shares one.
 * - A number that belongs to TWO OR MORE CRM customers links nobody. The
 *   number no longer says which of them wrote, so a person decides.
 * - A lead that is already linked is never touched. Re-matching it could only
 *   overwrite a person's decision with a rule's.
 * - A name is never read here at all.
 */

import { isAutoLinkable, normalizeLebanesePhone } from "@/lib/leads/phone";

export interface LinkLead {
  id: string;
  phone: string | null;
  crmCustomerId: string | null;
}

export interface LinkCustomer {
  customerId: string;
  phone: string | null;
}

export interface PlannedLink {
  leadId: string;
  crmCustomerId: string;
}

export interface LinkPlan {
  links: PlannedLink[];
  /** Counts only — for a sentence on a screen, never for a list of people. */
  counts: {
    leads: number;
    alreadyLinked: number;
    /** No number, a landline, or a number that is not Lebanese. */
    noMobile: number;
    /** A mobile nobody in the CRM (as this person may see it) has. */
    notInCrm: number;
    /** A mobile two or more CRM customers share: left for a person. */
    sharedNumber: number;
    toLink: number;
  };
}

export function planPhoneLinks(leads: readonly LinkLead[], customers: readonly LinkCustomer[]): LinkPlan {
  // normalised mobile → the customers holding it. A Set, so one customer listed
  // twice (a duplicate row) is still one customer.
  const holders = new Map<string, Set<string>>();
  for (const c of customers) {
    if (!isAutoLinkable(c.phone)) continue;
    const n = normalizeLebanesePhone(c.phone);
    if (n === null) continue;
    const set = holders.get(n) ?? new Set<string>();
    set.add(c.customerId);
    holders.set(n, set);
  }

  const counts = { leads: leads.length, alreadyLinked: 0, noMobile: 0, notInCrm: 0, sharedNumber: 0, toLink: 0 };
  const links: PlannedLink[] = [];

  for (const lead of leads) {
    if (lead.crmCustomerId) {
      counts.alreadyLinked++;
      continue;
    }
    const n = isAutoLinkable(lead.phone) ? normalizeLebanesePhone(lead.phone) : null;
    if (n === null) {
      counts.noMobile++;
      continue;
    }
    const who = holders.get(n);
    if (!who) {
      counts.notInCrm++;
      continue;
    }
    if (who.size !== 1) {
      counts.sharedNumber++;
      continue;
    }
    links.push({ leadId: lead.id, crmCustomerId: [...who][0] });
  }

  counts.toLink = links.length;
  return { links, counts };
}

export type LinkCounts = LinkPlan["counts"];

/**
 * What /customers says about linking. Counts only, never who.
 *
 * Every lead is in exactly one group, so the figures add up to the total and
 * nobody has to wonder where the rest went.
 */
export function linkReport(result: { applied: boolean; linked: number; partial?: boolean; counts: LinkCounts }): string | null {
  const c = result.counts;
  if (c.leads === 0) return null;
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const head = result.applied
    ? `${n(result.linked, "chat was", "chats were")} linked to a CRM customer by mobile number just now${result.partial ? " (more will follow on the next visit)" : ""}.`
    : `Saving links to the CRM is switched off; nothing was changed.`;
  return (
    `${head} Of ${n(c.leads, "person who wrote", "people who wrote")}: ` +
    `${c.alreadyLinked} already linked, ` +
    `${c.toLink} ${result.applied ? "matched" : "could be linked"} to exactly one CRM customer, ` +
    `${c.sharedNumber} share a number with two or more CRM customers and are left for a person, ` +
    `${c.notInCrm} have a mobile number no CRM customer has, ` +
    `${c.noMobile} have no usable mobile number.`
  );
}
