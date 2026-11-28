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

/** One sentence for /customers. Says what was done, never who. */
export function linkSentence(result: { applied: boolean; toLink: number; linked: number; sharedNumber: number }): string | null {
  const shared = result.sharedNumber > 0 ? ` ${result.sharedNumber} more share a number with two CRM customers and are left for a person.` : "";
  if (result.applied) {
    if (result.linked === 0 && result.sharedNumber === 0) return null;
    return `${result.linked} chat${result.linked === 1 ? " was" : "s were"} linked to a CRM customer by mobile number just now.${shared}`;
  }
  if (result.toLink === 0 && result.sharedNumber === 0) return null;
  return `${result.toLink} chat${result.toLink === 1 ? "" : "s"} could be linked to a CRM customer by mobile number. Saving those links is switched off.${shared}`;
}
