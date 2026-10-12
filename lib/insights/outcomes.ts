/**
 * Why a lead was lost — the closed list a person picks from (026 insight_lead_outcomes). PURE.
 * The CRM records no reason, and an inactive lead is never assumed lost: only a person records this.
 */

export const LOST_REASONS: ReadonlyArray<[string, string]> = [
  ["price_too_high", "Price too high"],
  ["competitor_chosen", "Chose a competitor"],
  ["financing_unavailable", "Financing not available"],
  ["vehicle_unavailable", "Car not available"],
  ["colour_unavailable", "Preferred colour not available"],
  ["delivery_too_slow", "Delivery too slow"],
  ["charging_concerns", "Charging concerns"],
  ["warranty_concerns", "Warranty concerns"],
  ["no_follow_up", "Nobody followed up"],
  ["postponed", "Customer postponed"],
  ["other", "Other (confirmed)"],
];

export const LOST_LABEL: Readonly<Record<string, string>> = Object.fromEntries(LOST_REASONS);
export const isLostReason = (r: unknown): r is string => typeof r === "string" && (r === "cleared" || LOST_REASONS.some(([k]) => k === r));
