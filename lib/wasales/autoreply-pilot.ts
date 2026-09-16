/**
 * WHO the sales autoreply pilot may answer — and nobody else.
 *
 * Samer, 2026-09-16: "begin automation only between the chat between those 2
 * numbers" — his test phone (+961 3 195 955) writing to the business WhatsApp
 * (+961 70 708 585, account `wa-monza`). This is the ONE named exception to
 * CLAUDE.md rule 24; every other chat keeps the suggestion card and a person
 * pressing Send.
 *
 * The list lives in code, not in a database row or a dashboard, on purpose:
 * widening it is a reviewed change with Samer's decision behind it, never a
 * side effect of somebody editing a setting. Stopping it needs no code:
 * `SALES_AUTOREPLY_MODE=off` in Vercel, then a redeploy.
 *
 * Pure: no I/O, so every rule here is tested (tests/sales-autoreply.test.ts).
 */

export interface AutoreplyPilot {
  /** Our accounts it may answer on. */
  accounts: readonly string[];
  /** The customers it may answer, as WhatsApp ids — digits only. */
  peers: readonly string[];
}

export const AUTOREPLY_PILOT: AutoreplyPilot = Object.freeze({
  accounts: Object.freeze(["wa-monza"]),
  /** Samer's test phone, +961 3 195 955, as WhatsApp sends it. */
  peers: Object.freeze(["9613195955"]),
});

/** SALES_AUTOREPLY_MODE: "off" stops the pilot; anything else leaves it to the list. */
export function autoreplyMode(raw: string | undefined | null): "pilot" | "off" {
  return typeof raw === "string" && raw.trim().toLowerCase() === "off" ? "off" : "pilot";
}

/** May the pilot answer this chat? WhatsApp only, a listed account, a listed customer. */
export function isPilotChat(
  chat: { accountId: string; channel: string; peerExternalId: string },
  pilot: AutoreplyPilot = AUTOREPLY_PILOT
): boolean {
  if (chat.channel !== "whatsapp") return false;
  if (!pilot.accounts.includes(chat.accountId)) return false;
  const digits = chat.peerExternalId.replace(/\D/g, "");
  return digits.length >= 8 && pilot.peers.includes(digits);
}
