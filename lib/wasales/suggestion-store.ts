/**
 * Where a chat's sales-suggestion memory is kept (migration 011,
 * sales_suggestion_state) — SERVER ONLY, through the service-role client in
 * lib/channels/store.ts. Engine state and our own sent message ids; never the
 * customer's words.
 *
 * Saves are optimistic: each names the `rev` it read, and a save against a
 * newer row is refused as a conflict. That is what stops two people pressing
 * Send on the same suggestion from sending it twice.
 */

import { channelDb } from "@/lib/channels/store";
import { parseState } from "@/lib/wasales/context";
import { freshSaved, MAX_REMEMBERED_IDS, type SavedSuggestion } from "@/lib/wasales/suggest";

const TABLE = "sales_suggestion_state";
const REF = /^[A-Za-z0-9_.:=-]{1,200}$/;

/** A stored row, read defensively — anything unreadable becomes its fresh value. */
export function savedFromRow(row: unknown): SavedSuggestion {
  if (!row || typeof row !== "object") return freshSaved();
  const r = row as Record<string, unknown>;
  const ids = Array.isArray(r.sent_message_ids)
    ? r.sent_message_ids.filter((id): id is string => typeof id === "string" && id.length <= 200)
    : [];
  const resumed =
    typeof r.resumed_at === "string" && Number.isFinite(Date.parse(r.resumed_at)) ? r.resumed_at : null;
  const rev = typeof r.rev === "number" && Number.isInteger(r.rev) && r.rev >= 0 ? r.rev : 0;
  return {
    state: parseState(r.state),
    sentMessageIds: ids.slice(-MAX_REMEMBERED_IDS),
    resumedAt: resumed,
    rev,
  };
}

export type LoadResult = { ok: true; saved: SavedSuggestion } | { ok: false; problem: string };

export async function loadSuggestion(accountId: string, conversationRef: string): Promise<LoadResult> {
  if (!REF.test(conversationRef)) return { ok: false, problem: "That is not a conversation reference." };
  const sb = channelDb();
  if (!sb) return { ok: false, problem: "The database is not configured on this server." };
  const { data, error } = await sb
    .from(TABLE)
    .select("state, sent_message_ids, resumed_at, rev")
    .eq("account_id", accountId)
    .eq("conversation_ref", conversationRef)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      problem: /does not exist|schema cache/i.test(error.message)
        ? "The suggestion memory is not set up yet (migration 011)."
        : "Could not read the suggestion memory just now.",
    };
  }
  return { ok: true, saved: data ? savedFromRow(data) : freshSaved() };
}

/**
 * Save `saved` if the row is still at `expectedRev` (0 = no row yet).
 * `saved.rev` must be `expectedRev + 1`.
 */
export async function saveSuggestion(input: {
  accountId: string;
  brand: string;
  conversationRef: string;
  saved: SavedSuggestion;
  expectedRev: number;
}): Promise<"saved" | "conflict" | "error"> {
  if (!REF.test(input.conversationRef) || input.saved.rev !== input.expectedRev + 1) return "error";
  const sb = channelDb();
  if (!sb) return "error";
  const row = {
    state: input.saved.state,
    sent_message_ids: input.saved.sentMessageIds.slice(-MAX_REMEMBERED_IDS),
    resumed_at: input.saved.resumedAt,
    rev: input.saved.rev,
    updated_at: new Date().toISOString(),
  };

  if (input.expectedRev === 0) {
    const { error } = await sb
      .from(TABLE)
      .insert({ account_id: input.accountId, conversation_ref: input.conversationRef, brand: input.brand, ...row });
    if (!error) return "saved";
    return error.code === "23505" ? "conflict" : "error";
  }

  const { data, error } = await sb
    .from(TABLE)
    .update(row)
    .eq("account_id", input.accountId)
    .eq("conversation_ref", input.conversationRef)
    .eq("rev", input.expectedRev)
    .select("rev");
  if (error) return "error";
  return Array.isArray(data) && data.length === 1 ? "saved" : "conflict";
}
