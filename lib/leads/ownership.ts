/**
 * Who may take, release and assign a lead — PURE (Samer, 2026-10-12: "Take this lead"; "Sales +
 * managers"). The server is lib/leads/ownership-server.ts; tested in tests/lead-ownership.test.ts.
 *
 *   sales, manage_team, owner   take an UNOWNED lead; release their OWN
 *   manage_team, owner          also assign / reassign anyone's, and release anyone's
 *
 * Taking a lead somebody else owns is refused with who owns it (409): a manager reassigns instead, so
 * a lead never changes hands without the person who had it being named in the history.
 */

export type OwnerAction = "take" | "release" | "assign";

export interface Actor {
  id: string;
  name: string;
  appRole: string | null;
  capabilities: readonly string[];
}

export interface Owner {
  id: string;
  name: string | null;
}

export type OwnershipDecision =
  | { ok: true; next: Owner | null; changed: boolean }
  | { ok: false; status: 403 | 409 | 400; reason: string; owner?: Owner | null };

export const canSell = (a: Actor) => a.appRole === "owner" || a.capabilities.includes("sales") || a.capabilities.includes("manage_team");
export const canManage = (a: Actor) => a.appRole === "owner" || a.capabilities.includes("manage_team");

export function ownershipDecision(actor: Actor, current: Owner | null, action: OwnerAction, target?: Owner | null): OwnershipDecision {
  if (!canSell(actor)) return { ok: false, status: 403, reason: "Only sales staff, managers and the owner can own a lead." };
  if (action === "take") {
    if (current?.id === actor.id) return { ok: true, next: current, changed: false };
    if (current) return { ok: false, status: 409, reason: `${current.name ?? "Someone"} already owns this lead.`, owner: current };
    return { ok: true, next: { id: actor.id, name: actor.name }, changed: true };
  }
  if (action === "release") {
    if (!current) return { ok: true, next: null, changed: false };
    if (current.id === actor.id || canManage(actor)) return { ok: true, next: null, changed: true };
    return { ok: false, status: 403, reason: `Only ${current.name ?? "the owner of this lead"} or a manager can release it.` };
  }
  // assign
  if (!canManage(actor)) return { ok: false, status: 403, reason: "Only a manager or the owner can assign a lead to someone." };
  if (!target || !/^[0-9a-f-]{36}$/i.test(target.id)) return { ok: false, status: 400, reason: "Choose who to assign it to." };
  if (current?.id === target.id) return { ok: true, next: current, changed: false };
  return { ok: true, next: target, changed: true };
}
