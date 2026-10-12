/**
 * Who may open Insights (Samer, 2026-10-12): the owner and staff with `manage_team` or `view_reports`.
 * Insights lists every client's name, number, cars and what they asked — a manager's view, not a
 * salesperson's. Pure, so it is tested without a CRM (tests/insights-access.test.ts).
 *
 * The demo identity (no CRM configured) is refused whenever MONZA AI's own database IS reachable:
 * otherwise a deployment with database keys but no CRM keys would show real clients to anyone. With no
 * database either, there is nothing real to show and the page says so.
 */

import { hasAnyCapability, isDemoIdentity } from "@/lib/auth";
import type { StaffIdentity } from "@/lib/connectors/types";

export const INSIGHTS_CAPS: readonly string[] = Object.freeze(["manage_team", "view_reports"]);

export function canSeeInsights(user: StaffIdentity | null, databaseConfigured: boolean): boolean {
  if (!user) return false;
  if (isDemoIdentity(user)) return !databaseConfigured;
  return hasAnyCapability(user, INSIGHTS_CAPS);
}
