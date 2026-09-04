/**
 * Choosing the source system.
 *
 * There is exactly one implementation today — the demo one — and that is
 * DELIBERATE. Real business data is not connected during this refactor: the
 * point of the adapter is that the product can be built, restructured and
 * tested against a stable interface first, and the live implementation dropped
 * in afterwards without touching a screen.
 *
 * When the Supabase source lands it goes here, selected by configuration, and
 * every caller keeps working:
 *
 *     return crmConfigured() ? supabaseSource : demoSource;
 *
 * Until then this function always returns the demo source, and every screen
 * that shows its data must say so — `source.kind === "demo"` is how they know.
 * Nothing is ever presented as live when it is not.
 */

import { demoSource } from "@/lib/domain/demo-source";
import type { ReadContext, SourceSystem } from "@/lib/domain/source";
import type { StaffIdentity } from "@/lib/connectors/types";

export type { ReadContext, SourceSystem } from "@/lib/domain/source";
export * from "@/lib/domain/types";

/** The source system this deployment reads business data from. */
export function getSource(): SourceSystem {
  return demoSource;
}

/** Build the read context for a staff member. */
export function readContext(identity: StaffIdentity): ReadContext {
  return { identity };
}

/** True when the business data on screen is invented and must be labelled. */
export function isDemoSource(source: SourceSystem = getSource()): boolean {
  return source.kind === "demo";
}
