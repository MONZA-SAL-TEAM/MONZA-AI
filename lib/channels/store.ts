/**
 * What MONZA AI records about channel conversations — the FACT of them, never
 * their content.
 *
 * SERVER ONLY. Uses the service-role key, which bypasses RLS entirely — the
 * channel tables have RLS on and no policies, so this module is the only way
 * in. It must never be imported from a client component.
 *
 * There is no `import "server-only"` guard because the package is not a
 * dependency here and adding one for a single import is not worth it. The
 * protection instead is that the key it needs is read through lib/env.ts,
 * which Next never inlines into a client bundle: imported from the browser
 * this module gets `null` and refuses every call rather than leaking anything.
 *
 * ── No copy of the messages (Samer, 2026-09-10) ─────────────────────────────
 * The inbox reads conversations live from Meta (lib/channels/live.ts). When a
 * message arrives by webhook, this module records only:
 *
 *   the thread index  which account, which customer id, when — so a lead can
 *                     point at it and the dashboard can count it
 *   the arrival       the message id and its time, with NO text and NO
 *                     attachments (inboundIndexRow takes no text at all)
 *   the lead          who wrote, which ad/post/story brought them, which car
 *                     they named — never their words (lib/leads/store.ts)
 *
 * and the verified delivery as its shape only (redactDelivery).
 *
 * ── Idempotency is the point ────────────────────────────────────────────────
 * Meta redelivers, for up to seven days. The arrival row's unique
 * `(account_id, external_message_id)` turns a redelivery into a no-op, and the
 * lead is noted only when that insert actually inserted — otherwise every
 * retry would count the same person, and the same ad, again.
 *
 * ── Brand comes from the account, never from the payload ────────────────────
 * A message's brand is looked up from the account it arrived at. It is never
 * read from the message, inferred from its text, or passed in by a caller. The
 * database enforces the same rule with composite foreign keys.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { noStoreFetch } from "@/lib/supabase-fetch";
import { aiServiceRoleKey, aiUrl } from "@/lib/env";
import type { InboundEvent } from "@/lib/channels/types";
import { inboundIndexRow, redactDelivery, type DeliveryRecord } from "@/lib/channels/live-map";
import { noteInboundLead } from "@/lib/leads/store";

export interface StoredAccount {
  id: string;
  brand: string;
  channel: string;
  displayName: string;
  externalId: string;
  portfolio: string;
  tokenEnv: string;
  connectedAt: string | null;
  /** The Meta app this account belongs to (006). Null when not recorded. */
  appId: string | null;
}

export type StoreResult =
  | { ok: true; stored: number; duplicates: number; unmatched: number }
  | { ok: false; error: string };

function client(): SupabaseClient | null {
  const key = aiServiceRoleKey();
  if (!key) return null;
  return createClient(aiUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: noStoreFetch },
  });
}

/** The connected accounts, from the database rather than from code, so
 *  connecting one does not need a deploy. */
const ACCOUNT_COLUMNS =
  "id, brand, channel, display_name, external_id, portfolio, token_env, connected_at";

export async function listAccounts(): Promise<StoredAccount[]> {
  const sb = client();
  if (!sb) return [];

  // app_id arrived in 006. Until that migration is applied the column does not
  // exist, and asking for it would fail the whole read, which would make EVERY
  // delivery unmatched. So fall back to the old columns and report no app.
  // One loose shape both selects fit: the typed select strings otherwise
  // produce two different row types and the fallback cannot be assigned.
  type AccountRows = {
    data: Record<string, unknown>[] | null;
    error: { message: string } | null;
  };
  let res: AccountRows = await sb
    .from("channel_accounts")
    .select(`${ACCOUNT_COLUMNS}, app_id`)
    .order("display_name");
  if (res.error && /app_id/.test(res.error.message ?? "")) {
    res = await sb.from("channel_accounts").select(ACCOUNT_COLUMNS).order("display_name");
  }

  const { data, error } = res;
  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id as string,
    brand: r.brand as string,
    channel: r.channel as string,
    displayName: r.display_name as string,
    externalId: r.external_id as string,
    portfolio: r.portfolio as string,
    tokenEnv: r.token_env as string,
    connectedAt: (r.connected_at as string | null) ?? null,
    appId: (r.app_id as string | null | undefined) ?? null,
  }));
}

/**
 * Find or create the index row for one person on one account.
 *
 * Returns the conversation id; the brand is taken FROM THE ACCOUNT — the caller
 * does not get to supply it.
 */
async function upsertConversation(
  sb: SupabaseClient,
  accountId: string,
  brand: string,
  peerExternalId: string
): Promise<string | null> {
  const { data, error } = await sb
    .from("channel_conversations")
    .upsert(
      { account_id: accountId, brand, peer_external_id: peerExternalId },
      { onConflict: "account_id,peer_external_id" }
    )
    .select("id")
    .single();

  if (error || !data) return null;
  return data.id as string;
}

/**
 * Record a batch of inbound events — that they happened, not what they said.
 *
 * Safe to call with the same events repeatedly: that is the normal case, not
 * the exceptional one.
 */
export async function storeInbound(events: readonly InboundEvent[]): Promise<StoreResult> {
  if (events.length === 0) return { ok: true, stored: 0, duplicates: 0, unmatched: 0 };

  const sb = client();
  if (!sb) return { ok: false, error: "The database is not configured on this server." };

  const accounts = await listAccounts();
  const byId = new Map(accounts.map((a) => [a.id, a]));

  let stored = 0;
  let duplicates = 0;
  let unmatched = 0;

  for (const event of events) {
    // A message for an account nobody has connected. Not an error — Meta
    // delivers everything the app is subscribed to — but there is no brand to
    // file it under, and guessing one is exactly the cross-brand mistake the
    // schema exists to prevent.
    const account = event.accountId ? byId.get(event.accountId) : undefined;
    if (!account) {
      unmatched++;
      continue;
    }

    const conversationId = await upsertConversation(
      sb,
      account.id,
      account.brand,
      event.fromExternalId
    );
    if (!conversationId) return { ok: false, error: "Could not open the conversation." };

    // The arrival, without its words. `ignoreDuplicates` turns the unique
    // constraint into a no-op, and the empty result is how a redelivery is
    // recognised.
    const { data: inserted, error } = await sb
      .from("channel_messages")
      .upsert(
        inboundIndexRow({
          conversationId,
          brand: account.brand,
          accountId: account.id,
          externalMessageId: event.externalMessageId,
          at: event.at,
        }),
        { onConflict: "account_id,external_message_id", ignoreDuplicates: true }
      )
      .select("id");

    if (error) return { ok: false, error: "Could not record the message." };

    if (!inserted || inserted.length === 0) {
      duplicates++;
      continue;
    }

    stored++;

    // Only for a NEW message: advance "last heard from", then note the lead.
    await sb.rpc("channel_note_inbound", {
      p_conversation: conversationId,
      p_at: event.at,
    });

    // Attribution is captured HERE, at the moment of arrival, because Meta
    // attaches a referral to the first message of a thread and to no other and
    // no endpoint returns it afterwards. The text is read in memory for a car
    // name and then dropped — lib/leads/store.ts keeps the car, not the words.
    //
    // Best-effort: failing the whole delivery would make Meta retry for seven
    // days and then disable the endpoint for every brand.
    await noteInboundLead(sb, {
      conversationId,
      brand: account.brand,
      channel: account.channel,
      event,
      // Instagram and Messenger peer ids are NOT phone numbers, however
      // numeric they look. Only a channel that genuinely carries one may pass
      // it, and passing an IG id here would auto-link strangers to each other.
      phone: account.channel === "whatsapp" ? event.fromExternalId : null,
    });
  }

  return { ok: true, stored, duplicates, unmatched };
}

/** Record that a verified delivery happened — its shape, never its words — for
 *  the day a message does not appear and the question is whether Meta actually
 *  sent it. Best-effort: a failure here must never fail the delivery. */
export async function recordDelivery(
  channel: string | null,
  payload: unknown,
  eventCount: number,
  storedCount: number
): Promise<void> {
  const sb = client();
  if (!sb) return;
  try {
    await sb.from("channel_deliveries").insert({
      channel,
      payload: redactDelivery(payload) as never,
      event_count: eventCount,
      stored_count: storedCount,
    });
  } catch {
    /* diagnostics are not worth failing a delivery over */
  }
}

/**
 * The delivery record, newest first, for the staff-only diagnosis. Capped
 * because this answers "has anything ever arrived", not "show me everything",
 * and an uncapped read of a table Meta writes to would grow without limit.
 *
 * Returns rows or the reason it could not read them — never an empty list
 * standing in for a failed read, which would report "Meta sent nothing" when
 * the truth is "we could not look".
 */
export const DELIVERY_SAMPLE = 500;

export async function readDeliveries(
  limit = DELIVERY_SAMPLE
): Promise<{ ok: true; rows: DeliveryRecord[]; limit: number } | { ok: false; error: string }> {
  const sb = client();
  if (!sb) return { ok: false, error: "The database key for this product is not configured." };
  try {
    const { data, error } = await sb
      .from("channel_deliveries")
      .select("payload, event_count, stored_count, received_at")
      .order("received_at", { ascending: false })
      .limit(limit);
    if (error) return { ok: false, error: error.message };
    return { ok: true, rows: (data ?? []).map(deliveryRecord), limit };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The delivery record could not be read." };
  }
}

/** One stored row, read defensively: the payload is whatever shape arrived. */
function deliveryRecord(row: Record<string, unknown>): DeliveryRecord {
  const payload = row.payload && typeof row.payload === "object" ? (row.payload as Record<string, unknown>) : {};
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  return {
    object: typeof payload.object === "string" ? payload.object : null,
    ids: entries
      .map((e) => (e && typeof e === "object" ? (e as Record<string, unknown>).id : null))
      .filter((id): id is string => typeof id === "string"),
    receivedAt: typeof row.received_at === "string" ? row.received_at : "",
    eventCount: typeof row.event_count === "number" ? row.event_count : 0,
    storedCount: typeof row.stored_count === "number" ? row.stored_count : 0,
  };
}
