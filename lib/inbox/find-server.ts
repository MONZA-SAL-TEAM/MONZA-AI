/**
 * Finding a person for the inbox's search box — SERVER ONLY (lib/inbox/find.ts is the pure half).
 *
 * The same two reads as the Customers page: MONZA AI's own records (`listPeople`, every table, up to 20k
 * rows — kept 60 s in this server's memory because a search box asks on every pause in typing) and the
 * CRM's customers AS THE VIEWER (`listCrmCustomers`, their own token, kept 2 minutes per person — a CRM
 * read is the slow one, and the CRM's row-level security already decided what they may see). Nothing is
 * stored. A CRM that cannot be read costs only the CRM names: the search still answers from our records.
 */

import type { StaffIdentity } from "@/lib/connectors/types";
import { listPeople } from "@/lib/leads/people-server";
import { listCrmCustomers } from "@/lib/leads/people-crm";
import { mergeCrm, type CrmRecord, type Person } from "@/lib/leads/people";
import { findPeople, type FoundPerson } from "@/lib/inbox/find";

const PEOPLE_MS = 60_000;
const CRM_MS = 2 * 60_000;
let people: { at: number; list: Person[] } | null = null;
const crm = new Map<string, { at: number; customers: CrmRecord[] | null }>();

export interface FindResult {
  found: FoundPerson[];
  /** The CRM could not be read, so CRM names and numbers are missing from the answer. */
  crmUnavailable: boolean;
}

export async function findForInbox(user: StaffIdentity, query: string): Promise<FindResult | null> {
  const now = Date.now();
  if (!people || now - people.at > PEOPLE_MS) {
    const list = await listPeople();
    if (!list) return null;
    people = { at: now, list };
  }
  let c = crm.get(user.userId);
  if (!c || now - c.at > CRM_MS) {
    const read = await listCrmCustomers(user);
    c = { at: now, customers: read.state === "ok" ? read.customers : read.state === "not_connected" ? [] : null };
    crm.set(user.userId, c);
    // A map that only grows is a leak on a long-lived instance.
    for (const [k, v] of crm) if (now - v.at > CRM_MS) crm.delete(k);
  }
  const merged = c.customers ? mergeCrm(people.list, c.customers) : people.list;
  return { found: findPeople(merged, query), crmUnavailable: c.customers === null };
}
