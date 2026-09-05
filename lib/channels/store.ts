/**
 * Persisting channel conversations.
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
 * That is a weaker guarantee than a build error, so: do not import it from a
 * "use client" file, and if that ever becomes tempting, add the package.
 *
 * ── Idempotency is the point ────────────────────────────────────────────────
 * Meta redelivers. A delivery that times out, fails, or that we answer slowly
 * comes again, for up to seven days. Every write here therefore has to be safe
 * to repeat:
 *
 *   the message   `on conflict (account_id, external_message_id) do nothing`,
 *                 which is why the constraint exists in 003_channels.sql
 *   the thread    `on conflict (account_id, peer_external_id) do update`,
 *                 which finds the existing thread rather than making a second
 *   the counters  advanced only when the message was actually NEW
 *
 * That last one is the part that is easy to get wrong: bumping unread_count
 * before checking whether the insert did anything means a redelivered message
 * inflates the badge every time Meta retries.
 *
 * ── Brand comes from the account, never from the payload ────────────────────
 * A message's brand is looked up from the account it arrived at. It is never
 * read from the message, inferred from its text, or passed in by a caller. The
 * database enforces the same rule with composite foreign keys, so a mistake
 * here is a constraint violation rather than a customer of one marque appearing
 * under another.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { aiServiceRoleKey, aiUrl } from "@/lib/env";
import type { InboundEvent } from "@/lib/channels/types";

export interface StoredAccount {
  id: string;
  brand: string;
  channel: string;
  displayName: string;
  externalId: string;
  portfolio: string;
  tokenEnv: string;
  connectedAt: string | null;
}

export type StoreResult =
  | { ok: true; stored: number; duplicates: number; unmatched: number }
  | { ok: false; error: string };

function client(): SupabaseClient | null {
  const key = aiServiceRoleKey();
  if (!key) return null;
  return createClient(aiUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** The connected accounts, from the database rather than from code, so
 *  connecting one does not need a deploy. */
export async function listAccounts(): Promise<StoredAccount[]> {
  const sb = client();
  if (!sb) return [];
  const { data, error } = await sb
    .from("channel_accounts")
    .select("id, brand, channel, display_name, external_id, portfolio, token_env, connected_at")
    .order("display_name");
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
  }));
}

/**
 * Find or create the thread with one person on one account.
 *
 * Returns the conversation id and the brand taken FROM THE ACCOUNT — the
 * caller does not get to supply either.
 */
async function upsertConversation(
  sb: SupabaseClient,
  accountId: string,
  brand: string,
  peerExternalId: string,
  peerDisplay: string | null
): Promise<string | null> {
  const { data, error } = await sb
    .from("channel_conversations")
    .upsert(
      {
        account_id: accountId,
        brand,
        peer_external_id: peerExternalId,
        // Only overwrite the display name when we actually learned one;
        // Instagram does not send it, and null must not erase a good value.
        ...(peerDisplay ? { peer_display: peerDisplay } : {}),
      },
      { onConflict: "account_id,peer_external_id" }
    )
    .select("id")
    .single();

  if (error || !data) return null;
  return data.id as string;
}

/**
 * Store a batch of inbound events.
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
    // delivers everything the app is subscribed to — but it must NOT be
    // stored: there is no brand to file it under, and guessing one is exactly
    // the cross-brand mistake the schema exists to prevent.
    const account = event.accountId ? byId.get(event.accountId) : undefined;
    if (!account) {
      unmatched++;
      continue;
    }

    const conversationId = await upsertConversation(
      sb,
      account.id,
      account.brand,
      event.fromExternalId,
      event.fromDisplay
    );
    if (!conversationId) return { ok: false, error: "Could not open the conversation." };

    // The insert that must be idempotent. `ignoreDuplicates` turns the unique
    // constraint into a no-op instead of an error, and the empty result is how
    // we know this delivery was a repeat.
    const { data: inserted, error } = await sb
      .from("channel_messages")
      .upsert(
        {
          conversation_id: conversationId,
          brand: account.brand,
          account_id: account.id,
          direction: "in",
          author: "customer",
          body: event.text,
          attachments: event.attachments,
          external_message_id: event.externalMessageId,
          status: "received",
          sent_at: event.at,
        },
        { onConflict: "account_id,external_message_id", ignoreDuplicates: true }
      )
      .select("id");

    if (error) return { ok: false, error: "Could not store the message." };

    if (!inserted || inserted.length === 0) {
      // Meta sent this one before. Nothing else must happen: the counters and
      // the thread timestamps already reflect it.
      duplicates++;
      continue;
    }

    stored++;

    // Only now — a NEW customer message reopens the thread, advances the
    // window and bumps the badge. Doing this above would let a redelivery
    // inflate the unread count on every retry.
    await sb.rpc("channel_note_inbound", {
      p_conversation: conversationId,
      p_at: event.at,
    });
  }

  return { ok: true, stored, duplicates, unmatched };
}

/** Record a verified delivery, for the day a message does not appear and the
 *  question is whether Meta actually sent it. Best-effort: a failure here must
 *  never fail the delivery. */
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
      payload: payload as never,
      event_count: eventCount,
      stored_count: storedCount,
    });
  } catch {
    /* diagnostics are not worth failing a delivery over */
  }
}
