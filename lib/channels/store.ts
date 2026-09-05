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
import type { Conversation, InboxMessage } from "@/lib/inbox/types";

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

/* ── Reading, for the inbox ──────────────────────────────────────────────── */

/**
 * The real conversations, in the shape the inbox already renders.
 *
 * Mapped onto lib/inbox/types rather than exposing the table's own shape, so
 * the screen keeps working the same whether a thread came from here or from
 * the demo dataset — and so a schema change does not reach the UI.
 */
export async function listConversations(): Promise<Conversation[]> {
  const sb = client();
  if (!sb) return [];

  // Accounts are fetched separately rather than joined. A PostgREST embedded
  // select needs generated database types to infer, and this project has none;
  // the account list is tiny and already needed elsewhere, so a second query
  // costs nothing and keeps the types honest.
  const accounts = await listAccounts();
  const channelOf = new Map(accounts.map((a) => [a.id, a.channel]));

  const { data, error } = await sb
    .from("channel_conversations")
    // ONE string literal, not a concatenation: PostgREST infers the row type
    // from the literal, and a `+` turns every column into an error type.
    .select("id, account_id, brand, peer_external_id, peer_display, customer_id, status, assigned_to, unread_count, last_message_at")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(200);
  if (error || !data) return [];

  // One query for every thread's latest message, rather than one per thread.
  const lastByThread = await lastMessageOf(
    sb,
    data.map((r) => r.id as string)
  );

  return data.map((r): Conversation => {
    const peer = (r.peer_display as string | null) ?? (r.peer_external_id as string);
    const last = lastByThread.get(r.id as string);
    return {
      id: r.id as string,
      // Empty until somebody links the thread to the CRM. Instagram gives no
      // phone number, so most threads start unidentified — and the inbox must
      // still show them rather than hiding a customer it cannot name.
      customerId: (r.customer_id as string | null) ?? "",
      customerName: peer,
      channel: (channelOf.get(r.account_id as string) ??
        "instagram") as Conversation["channel"],
      channelAddress: peer,
      assignedTo: (r.assigned_to as string | null) ?? null,
      assignedToName: null,
      status: r.status as Conversation["status"],
      unreadCount: (r.unread_count as number) ?? 0,
      lastMessage: last ?? {
        text: "",
        at: (r.last_message_at as string | null) ?? new Date(0).toISOString(),
        direction: "in",
        author: "customer",
      },
      hasAutomatedMessage: false,
    };
  });
}

async function lastMessageOf(
  sb: SupabaseClient,
  conversationIds: readonly string[]
): Promise<Map<string, Conversation["lastMessage"]>> {
  const out = new Map<string, Conversation["lastMessage"]>();
  if (conversationIds.length === 0) return out;

  const { data } = await sb
    .from("channel_messages")
    .select("conversation_id, body, sent_at, direction, author")
    .in("conversation_id", conversationIds as string[])
    .order("sent_at", { ascending: false });
  if (!data) return out;

  // Descending order, so the FIRST row seen for a thread is its latest.
  for (const m of data) {
    const id = m.conversation_id as string;
    if (out.has(id)) continue;
    out.set(id, {
      text: m.body as string,
      at: m.sent_at as string,
      direction: m.direction as "in" | "out",
      author: m.author as Conversation["lastMessage"]["author"],
    });
  }
  return out;
}

/** Every message in the listed threads, oldest first. */
export async function listMessages(
  conversationIds: readonly string[]
): Promise<InboxMessage[]> {
  const sb = client();
  if (!sb || conversationIds.length === 0) return [];

  const { data, error } = await sb
    .from("channel_messages")
    .select("id, conversation_id, direction, author, body, sent_at, status, staff_name, automation_id")
    .in("conversation_id", conversationIds as string[])
    .order("sent_at", { ascending: true })
    .limit(2000);
  if (error || !data) return [];

  return data.map((m): InboxMessage => ({
    id: m.id as string,
    conversationId: m.conversation_id as string,
    direction: m.direction as "in" | "out",
    author: m.author as InboxMessage["author"],
    text: m.body as string,
    at: m.sent_at as string,
    status: m.status as InboxMessage["status"],
    ...(m.automation_id ? { automationId: m.automation_id as string } : {}),
    ...(m.staff_name ? { staffName: m.staff_name as string } : {}),
  }));
}

/** True when at least one channel account is connected. Decides whether the
 *  inbox shows real threads or the demo dataset — never both at once. */
export async function anyAccountConnected(): Promise<boolean> {
  return (await listAccounts()).length > 0;
}

/* ── Outbound ────────────────────────────────────────────────────────────── */

export interface OutboundRecord {
  conversationId: string;
  text: string;
  staffId: string | null;
  staffName: string | null;
  /** Set once the platform accepted it. Null in log-only mode, and null for a
   *  send that failed — both are messages that exist for staff but not for the
   *  customer, and the status column is what tells them apart. */
  externalMessageId: string | null;
  status: "queued" | "sent" | "failed";
  error: string | null;
  at: string;
}

/**
 * The thread a reply is going to, with everything needed to decide whether it
 * may be sent. Reading this — rather than trusting the caller — is what stops
 * a request naming one conversation and a different account.
 */
export interface ConversationTarget {
  id: string;
  brand: string;
  accountId: string;
  channel: string;
  peerExternalId: string;
  tokenEnv: string;
  lastInboundAt: string | null;
}

export async function findConversation(
  conversationId: string
): Promise<ConversationTarget | null> {
  const sb = client();
  if (!sb) return null;

  const { data, error } = await sb
    .from("channel_conversations")
    .select("id, brand, account_id, peer_external_id, last_inbound_at")
    .eq("id", conversationId)
    .maybeSingle();
  if (error || !data) return null;

  const account = (await listAccounts()).find(
    (a) => a.id === (data.account_id as string)
  );
  if (!account) return null;

  return {
    id: data.id as string,
    brand: data.brand as string,
    accountId: account.id,
    channel: account.channel,
    peerExternalId: data.peer_external_id as string,
    tokenEnv: account.tokenEnv,
    lastInboundAt: (data.last_inbound_at as string | null) ?? null,
  };
}

/**
 * Record a staff reply on the thread.
 *
 * The brand and account are taken from the CONVERSATION, never from the
 * request — the same rule as inbound, for the same reason.
 */
export async function storeOutbound(
  target: ConversationTarget,
  record: OutboundRecord
): Promise<{ ok: boolean; error?: string }> {
  const sb = client();
  if (!sb) return { ok: false, error: "The database is not configured." };

  const { error } = await sb.from("channel_messages").insert({
    conversation_id: target.id,
    brand: target.brand,
    account_id: target.accountId,
    direction: "out",
    author: "staff",
    body: record.text,
    external_message_id: record.externalMessageId,
    status: record.status,
    error: record.error,
    staff_id: record.staffId,
    staff_name: record.staffName,
    sent_at: record.at,
  });
  if (error) return { ok: false, error: "Could not save the reply." };

  // A reply means the thread is now waiting on the customer, and the unread
  // badge is cleared — staff have plainly read it.
  await sb
    .from("channel_conversations")
    .update({
      status: "waiting_reply",
      unread_count: 0,
      last_message_at: record.at,
      updated_at: new Date().toISOString(),
    })
    .eq("id", target.id);

  return { ok: true };
}
