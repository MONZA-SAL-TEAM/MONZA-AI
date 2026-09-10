/**
 * THE LIVE INBOX, pure half — Meta's Conversations API answers → inbox shapes.
 *
 * ── Samer's rule, 2026-09-10 ────────────────────────────────────────────────
 * "I do not want it to store, I want it to display from Instagram — and
 * Facebook." The messages live on Instagram and Facebook. MONZA AI reads them
 * from Meta each time the inbox is looked at and keeps NO copy of what anybody
 * wrote. Replies go back out through Meta, so they appear in the Instagram and
 * Facebook apps as well.
 *
 * What is still recorded when a message arrives (lib/channels/store.ts): THAT a
 * message came, to which account, when — and the one thing Meta says once and
 * never again, which ad, post or story brought them. Never the words.
 *
 * PURE: JSON in, inbox types out. No network, no clock, no token, so every
 * shape Meta sends is testable from a fixture. The network half is live.ts.
 */

import type { ChannelKey } from "@/lib/domain/types";
import type { Conversation, InboxMessage } from "@/lib/inbox/types";

/** What the live layer needs to know about a connected account. */
export interface LiveAccount {
  /** Ours: "ig-voyah", "fb-mhero". */
  id: string;
  brand: string;
  channel: string;
  displayName: string;
  /** Instagram: the IG user id. Facebook: the Page id. */
  externalId: string;
}

/**
 * How one account's read went. Four states, not a boolean, for the same reason
 * as the dashboard's: an account that could not be read must never look like
 * an account nobody wrote to.
 */
export type AccountState = "ok" | "no_token" | "no_page" | "error" | "deferred";

export interface AccountStatus {
  id: string;
  label: string;
  state: AccountState;
  /** Plain words for staff when state is not "ok". Never a token or secret. */
  problem: string | null;
  conversations: number;
  /** Meta's cursor for this account's next page; null when there is no more. */
  next: string | null;
  /** True when Meta only answered the lighter list (no message previews). */
  lite: boolean;
}

export function accountLabel(account: LiveAccount): string {
  const network = account.channel === "instagram" ? "Instagram" : "Facebook";
  return `${account.displayName} (${network})`;
}

/* ── Small readers ───────────────────────────────────────────────────────── */

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function list(value: unknown): unknown[] {
  const data = obj(value)?.data;
  return Array.isArray(data) ? data : [];
}

/* ── Thread ids ──────────────────────────────────────────────────────────── */

/**
 * The inbox's id for a live thread: OUR account id, then Meta's conversation
 * id. The account half is what every server call looks up in our registry, so
 * which brand's token reads or answers a thread is decided by us, never by the
 * browser.
 */
const SEP = "~";
const ACCOUNT_ID = /^[a-z0-9-]{1,40}$/;
/**
 * Meta's conversation ids ("t_1234…" on Messenger, base64-ish on Instagram).
 * The id is interpolated into a Graph URL path, so "/", "?", "&" and "#" must
 * be impossible here — otherwise a crafted id could steer the request to a
 * different Graph endpoint using the brand's token.
 */
const META_ID = /^[A-Za-z0-9_=.:-]{1,200}$/;

export function encodeThreadId(accountId: string, metaConversationId: string): string {
  return `${accountId}${SEP}${metaConversationId}`;
}

export function decodeThreadId(
  id: unknown
): { accountId: string; metaConversationId: string } | null {
  if (typeof id !== "string") return null;
  const at = id.indexOf(SEP);
  if (at <= 0) return null;
  const accountId = id.slice(0, at);
  const metaConversationId = id.slice(at + 1);
  if (!ACCOUNT_ID.test(accountId) || !META_ID.test(metaConversationId)) return null;
  return { accountId, metaConversationId };
}

/* ── Which Page reads which account ─────────────────────────────────────── */

/**
 * The Facebook Page an account's conversations are read through.
 *
 * Instagram DMs are read via the Page linked to the IG account, so an
 * Instagram account borrows the Page of the SAME BRAND — never another brand's
 * (rule 4). Two Pages for one brand is ambiguous, and ambiguity refuses rather
 * than guesses.
 */
export function pageIdFor(
  account: LiveAccount,
  accounts: readonly LiveAccount[]
): string | null {
  if (account.channel === "facebook") return account.externalId;
  if (account.channel !== "instagram") return null;
  const pages = accounts.filter(
    (a) => a.channel === "facebook" && a.brand === account.brand
  );
  return pages.length === 1 ? pages[0].externalId : null;
}

/** The two facts read from GET /{page-id}?fields=access_token,instagram_business_account. */
export function readPageInfo(json: unknown): { token: string | null; igId: string | null } {
  const root = obj(json);
  return {
    token: str(root?.access_token),
    igId: str(obj(root?.instagram_business_account)?.id),
  };
}

/* ── Mapping ─────────────────────────────────────────────────────────────── */

/** Graph writes "2026-09-10T09:00:00+0000"; add the colon every parser accepts. */
export function graphTime(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  const d = new Date(s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export interface Peer {
  /** The customer's id on that channel — who a reply is addressed to. */
  id: string;
  /** "@handle" on Instagram, the name on Facebook, when Meta shares it. */
  label: string | null;
}

/**
 * The customer in a conversation: the participant who is NOT us.
 * `selfIds` holds our Page id and, for Instagram, our IG account id.
 */
export function peerOf(conversation: unknown, selfIds: readonly string[]): Peer | null {
  for (const raw of list(obj(conversation)?.participants)) {
    const p = obj(raw);
    const id = str(p?.id);
    if (!id || selfIds.includes(id)) continue;
    const username = str(p?.username);
    return { id, label: username ? `@${username}` : str(p?.name) };
  }
  return null;
}

/** Shown for a message that is only a photo, video, sticker or file. */
export const NO_TEXT = "Photo, video or attachment — open the app to see it.";

function mapMessage(
  raw: unknown,
  threadId: string,
  selfIds: readonly string[]
): InboxMessage | null {
  const m = obj(raw);
  const id = str(m?.id);
  const at = graphTime(m?.created_time);
  const from = str(obj(m?.from)?.id);
  if (!id || !at || !from) return null;

  const ours = selfIds.includes(from);
  return {
    id,
    conversationId: threadId,
    direction: ours ? "out" : "in",
    author: ours ? "staff" : "customer",
    text: str(m?.message) ?? NO_TEXT,
    at,
    status: ours ? "sent" : "received",
  };
}

/** A conversation node's messages, OLDEST first (Meta sends newest first). */
export function mapThread(
  conversation: unknown,
  threadId: string,
  selfIds: readonly string[]
): InboxMessage[] {
  return list(obj(conversation)?.messages)
    .map((m) => mapMessage(m, threadId, selfIds))
    .filter((m): m is InboxMessage => m !== null)
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** GET /{page-id}/conversations → the inbox's rows for one account. */
export function mapConversations(
  json: unknown,
  account: LiveAccount,
  selfIds: readonly string[]
): Conversation[] {
  const out: Conversation[] = [];

  for (const raw of list(json)) {
    const c = obj(raw);
    const metaId = str(c?.id);
    if (!metaId || !META_ID.test(metaId)) continue;

    const threadId = encodeThreadId(account.id, metaId);
    const peer = peerOf(c, selfIds);
    // The listing asks for the latest message only; newest first.
    const last = mapThread(c, threadId, selfIds).at(-1) ?? null;
    const updated = graphTime(c?.updated_time);

    const name =
      peer?.label ??
      (account.channel === "instagram" ? "Instagram user" : "Facebook user");

    out.push({
      id: threadId,
      // Empty until somebody links the person to the CRM.
      customerId: "",
      customerName: name,
      channel: account.channel as ChannelKey,
      // Which brand's account they wrote to, so staff see it on every row and
      // can search "voyah" or "mhero".
      channelAddress: `${name} → ${account.displayName}`,
      assignedTo: null,
      assignedToName: null,
      // Meta keeps no "our status" — the honest reading is who spoke last.
      status: last?.direction === "out" ? "waiting_reply" : "open",
      unreadCount: 0,
      lastMessage: {
        text: last?.text ?? "",
        at: last?.at ?? updated ?? new Date(0).toISOString(),
        direction: last?.direction ?? "in",
        author: last?.author ?? "customer",
      },
      hasAutomatedMessage: false,
    });
  }

  return out;
}

export function sortNewestFirst(conversations: readonly Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => b.lastMessage.at.localeCompare(a.lastMessage.at));
}

/** When the customer last wrote — what the 24-hour reply window runs from. */
export function lastCustomerAt(messages: readonly InboxMessage[]): string | null {
  let latest: string | null = null;
  for (const m of messages) {
    if (m.direction === "in" && (latest === null || m.at > latest)) latest = m.at;
  }
  return latest;
}

/**
 * A Graph error, in words staff can act on. Rule 21: 200-with-empty is also a
 * permission symptom, but here an explicit error is what we get, and the code
 * decides the message.
 */
export function graphProblem(payload: unknown, httpStatus: number): string {
  const e = obj(obj(payload)?.error);
  const code = typeof e?.code === "number" ? e.code : null;

  if (code === 190) return "The access key for this account is invalid or has expired.";
  if (code === 10 || code === 3 || (code !== null && code >= 200 && code < 300)) {
    return "Meta has not yet given the app permission to read these messages (this needs Meta's approval).";
  }
  if (code === 4 || code === 17 || code === 32 || code === 613 || httpStatus === 429) {
    return "Meta is limiting requests for a moment. It will retry shortly.";
  }
  const message = str(e?.message);
  return message
    ? `Meta said: ${message.slice(0, 200)}`
    : `Meta answered with an error (HTTP ${httpStatus}).`;
}

/**
 * Meta's "Please reduce the amount of data you're asking for, then retry your
 * request". Not a refusal: the same question with fewer fields or fewer rows
 * succeeds. Seen on @voyahlebanon's conversation listing (2026-09-10) when each
 * row also carried its latest message.
 */
export function isTooMuchData(payload: unknown): boolean {
  const message = str(obj(obj(payload)?.error)?.message);
  return message !== null && /reduce the amount of data/i.test(message);
}

/* ── Paging ("Load more") ────────────────────────────────────────────────── */

/**
 * Meta's paging cursors are opaque base64-style strings. One comes back from
 * the browser for "Load more", so anything else is refused before it is put
 * into a Graph request. (It travels as a query value, never in the path.)
 */
export function isSafeCursor(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_=+/.-]{1,1024}$/.test(value);
}

/** The cursor for the next page of a Graph list, or null on the last page. */
export function nextCursor(json: unknown): string | null {
  const paging = obj(obj(json)?.paging);
  if (!str(paging?.next)) return null;
  const after = str(obj(paging?.cursors)?.after);
  return after && isSafeCursor(after) ? after : null;
}

/* ── What the webhook keeps: the fact, never the words ──────────────────── */

/**
 * The diagnostic copy of a verified delivery: its SHAPE — which object, which
 * accounts, how many events — so "did Meta actually send it?" stays
 * answerable. The body itself carries customer text and is not kept.
 */
export function redactDelivery(body: unknown): Record<string, unknown> {
  const root = obj(body);
  const entries = Array.isArray(root?.entry) ? root.entry : [];
  return {
    object: str(root?.object),
    entries: entries.map((raw) => {
      const e = obj(raw);
      const messaging = Array.isArray(e?.messaging) ? e.messaging.length : 0;
      const changes = Array.isArray(e?.changes) ? e.changes.length : 0;
      return { id: str(e?.id), events: messaging + changes };
    }),
  };
}

/**
 * The row that records THAT a customer message arrived. It exists for
 * redelivery (the unique message id makes Meta's retries no-ops, so a retry
 * cannot count a lead twice) and for "when did they last write".
 *
 * It deliberately takes no text and no attachments: a function that is never
 * handed the words cannot store them.
 */
export function inboundIndexRow(input: {
  conversationId: string;
  brand: string;
  accountId: string;
  externalMessageId: string;
  at: string;
}): Record<string, unknown> {
  return {
    conversation_id: input.conversationId,
    brand: input.brand,
    account_id: input.accountId,
    direction: "in",
    author: "customer",
    body: "",
    attachments: [],
    external_message_id: input.externalMessageId,
    status: "received",
    sent_at: input.at,
  };
}
