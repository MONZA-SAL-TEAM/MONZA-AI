/**
 * WHO GETS A NEW LEAD (Samer, 2026-11-25: "every actionable sales conversation must have a
 * responsible salesperson … new leads should follow configurable automatic assignment rules").
 *
 * Pure. The rules are rows an admin keeps (`lead_assignment_rules`, migration 033): a salesperson,
 * optionally only for a brand or a channel, with a weight. NO RULES = NOTHING IS ASSIGNED — the
 * product never picks a person on its own until an admin says who is in the rotation.
 *
 * A lead goes to the eligible person carrying the least open work relative to their weight, so two
 * salespeople at weight 1 share evenly and one at weight 2 takes twice as much.
 *
 * Not possible here: "an existing customer goes to their existing salesperson". MONZA AI may read
 * the CRM only as a signed-in person, never in the background, and no chat is linked to a CRM
 * customer yet. A manager assigns those by hand.
 */

export interface AssignmentRule {
  staffId: string;
  staffName: string;
  /** null = any. */
  brand: string | null;
  channel: string | null;
  weight: number;
  active: boolean;
}

export function chooseAssignee(
  rules: readonly AssignmentRule[],
  lead: { brand: string; channel: string },
  openLoad: Readonly<Record<string, number>>
): { staffId: string; staffName: string } | null {
  const eligible = rules.filter(
    (r) => r.active && r.weight > 0 && (r.brand === null || r.brand === lead.brand) && (r.channel === null || r.channel === lead.channel)
  );
  if (eligible.length === 0) return null;
  // A rule that names the brand or the channel is more specific than one that does not: it wins.
  const score = (r: AssignmentRule) => Number(r.brand !== null) + Number(r.channel !== null);
  const best = Math.max(...eligible.map(score));
  const pool = eligible.filter((r) => score(r) === best);
  const pick = [...pool].sort(
    (a, b) => (openLoad[a.staffId] ?? 0) / a.weight - (openLoad[b.staffId] ?? 0) / b.weight || a.staffId.localeCompare(b.staffId)
  )[0];
  return { staffId: pick.staffId, staffName: pick.staffName };
}
