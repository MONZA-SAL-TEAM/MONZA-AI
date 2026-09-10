/**
 * THE LIVE INBOX, network half — reads conversations from Meta and sends
 * replies through Meta. Nothing a customer or a staff member writes is saved
 * by MONZA AI (see the header of live-map.ts for Samer's rule).
 *
 * SERVER ONLY: reads each brand's access key from the environment. Keys are
 * held in memory for a few minutes at most and never written anywhere.
 *
 * ── Brand isolation still holds, and Meta enforces half of it ───────────────
 * Every call is made with the token of the account named in OUR registry, and
 * each brand's token belongs to a different business portfolio, so it cannot
 * read or answer another brand's conversation even if a crafted thread id
 * names one — Meta refuses. The other half is ours: the recipient of a reply
 * is read from the conversation on Meta, never taken from the browser.
 */

import { channelToken } from "@/lib/env";
import { listAccounts, type StoredAccount } from "@/lib/channels/store";
import { instagramAdapter } from "@/lib/channels/instagram";
import { messengerAdapter } from "@/lib/channels/messenger";
import { replyWindow, windowExplanation, type ReplyWindow } from "@/lib/channels/types";
import type { ChannelKey } from "@/lib/domain/types";
import type { Conversation, InboxMessage } from "@/lib/inbox/types";
import {
  accountLabel,
  decodeThreadId,
  graphProblem,
  isSafeCursor,
  isTooMuchData,
  lastCustomerAt,
  mapConversations,
  mapThread,
  nextCursor,
  pageIdFor,
  peerOf,
  readPageInfo,
  sortNewestFirst,
  type AccountState,
  type AccountStatus,
  type Peer,
} from "@/lib/channels/live-map";

const GRAPH = "https://graph.facebook.com/v21.0";
/**
 * How long one Graph call may take. Instagram's conversation listing is slow —
 * on 2026-09-10 VOYAH's Facebook list arrived well inside 8s while its
 * Instagram list did not — so the first, fullest list request gets longer.
 */
const TIMEOUT_MS = 12_000;
const LIST_TIMEOUT_MS = 20_000;
const MESSAGE_FIELDS = "id,created_time,from,message";

/**
 * How the conversation list is asked for, fullest first. When Meta is too
 * slow, or answers "reduce the amount of data", the next, lighter question is
 * tried: first without each conversation's latest message, then fewer rows.
 * Facebook normally answers the first; Instagram may need the second.
 */
const LIST_ATTEMPTS = [
  {
    fields: `id,updated_time,participants,messages.limit(1){${MESSAGE_FIELDS}}`,
    limit: 25,
    previews: true,
    timeoutMs: LIST_TIMEOUT_MS,
  },
  { fields: "id,updated_time,participants", limit: 25, previews: false, timeoutMs: TIMEOUT_MS },
  { fields: "id,updated_time,participants", limit: 10, previews: false, timeoutMs: TIMEOUT_MS },
] as const;

/** Messages shown per thread, fullest first. Instagram only details the latest 20. */
const THREAD_LIMITS = [20, 8] as const;

type GraphResult =
  | { ok: true; json: unknown }
  | { ok: false; problem: string; retryLighter: boolean };

async function graphGet(
  path: string,
  params: Record<string, string>,
  token: string,
  timeoutMs: number = TIMEOUT_MS
): Promise<GraphResult> {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json: unknown = await res.json().catch(() => null);
    const errored =
      !res.ok ||
      (json !== null && typeof json === "object" && "error" in (json as object));
    return errored
      ? { ok: false, problem: graphProblem(json, res.status), retryLighter: isTooMuchData(json) }
      : { ok: true, json };
  } catch (e) {
    // "Took too long" and "could not connect" need different fixes, so they
    // must not read the same on screen.
    const timedOut =
      e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return {
      ok: false,
      problem: timedOut ? "Meta took too long to answer." : "Could not reach Meta just now.",
      retryLighter: timedOut,
    };
  }
}

function isMetaChannel(account: StoredAccount): boolean {
  return account.channel === "instagram" || account.channel === "facebook";
}

/* ── Page access ─────────────────────────────────────────────────────────── */

interface PageInfo {
  token: string;
  igId: string | null;
  until: number;
}

/** Memory only, a few minutes. Never persisted, never logged. */
const pageCache = new Map<string, PageInfo>();
const PAGE_CACHE_MS = 10 * 60_000;

/**
 * The Page token to read and send with, and the IG account linked to the Page.
 *
 * The environment may hold a system-user token (preferred — it does not
 * expire) or the Page token itself. Asking the Page for its own access_token
 * converts the first into the second; with the second, Meta simply answers with
 * the same key, so both work.
 */
async function pageInfo(pageId: string, envToken: string): Promise<PageInfo> {
  const key = `${pageId}:${envToken.length}:${envToken.slice(-6)}`;
  const hit = pageCache.get(key);
  if (hit && hit.until > Date.now()) return hit;

  const r = await graphGet(pageId, { fields: "access_token,instagram_business_account" }, envToken);
  const read = r.ok ? readPageInfo(r.json) : { token: null, igId: null };
  const info: PageInfo = {
    token: read.token ?? envToken,
    igId: read.igId,
    until: Date.now() + PAGE_CACHE_MS,
  };
  if (r.ok) pageCache.set(key, info); // a failure is retried next time, not remembered
  return info;
}

type AccountContext =
  | { ok: true; pageId: string; token: string; selfIds: string[] }
  | { ok: false; state: Exclude<AccountState, "ok">; problem: string };

async function accountContext(
  account: StoredAccount,
  all: readonly StoredAccount[]
): Promise<AccountContext> {
  const pageId = pageIdFor(account, all);
  if (!pageId) {
    return {
      ok: false,
      state: "no_page",
      problem: "No Facebook Page of the same brand is registered, so this Instagram account cannot be read.",
    };
  }

  const envToken = channelToken(account.tokenEnv);
  if (!envToken) {
    return { ok: false, state: "no_token", problem: "The access key for this account has not been added yet." };
  }

  const info = await pageInfo(pageId, envToken);

  // Our own Instagram id decides which messages are "ours". If the registry
  // holds the wrong one, our replies would look like the customer's and a reply
  // could be addressed to ourselves — so it is checked against Meta, not trusted.
  if (account.channel === "instagram") {
    if (!info.igId) {
      return {
        ok: false,
        state: "error",
        problem: "Could not confirm which Instagram account is linked to this brand's Facebook Page.",
      };
    }
    if (info.igId !== account.externalId) {
      return {
        ok: false,
        state: "error",
        problem: `The Instagram ID on record (${account.externalId}) is not the one linked to the Page (${info.igId}). The record needs fixing before this account can be read.`,
      };
    }
  }

  return { ok: true, pageId, token: info.token, selfIds: [account.externalId, pageId] };
}

/* ── The inbox list ──────────────────────────────────────────────────────── */

/**
 * One page of one account's conversations. `after` is Meta's cursor for a
 * later page ("Load more"); `startAt` skips list attempts already known to
 * be too heavy for this account, so Instagram is not refused on every page.
 */
async function readAccount(
  account: StoredAccount,
  all: readonly StoredAccount[],
  after: string | null = null,
  startAt = 0
): Promise<{ status: AccountStatus; conversations: Conversation[] }> {
  const label = accountLabel(account);
  const failed = (state: Exclude<AccountState, "ok">, problem: string) => ({
    status: { id: account.id, label, state, problem, conversations: 0, next: null, lite: false },
    conversations: [],
  });

  try {
    const ctx = await accountContext(account, all);
    if (!ctx.ok) return failed(ctx.state, ctx.problem);

    const platform = account.channel === "instagram" ? "instagram" : "messenger";
    const path = `${ctx.pageId}/conversations`;

    let r: GraphResult = { ok: false, problem: "Nothing was asked.", retryLighter: false };
    const attempts = LIST_ATTEMPTS.slice(Math.min(startAt, LIST_ATTEMPTS.length - 1));
    let used: (typeof LIST_ATTEMPTS)[number] = attempts[0];
    for (const attempt of attempts) {
      used = attempt;
      r = await graphGet(
        path,
        {
          platform,
          fields: attempt.fields,
          limit: String(attempt.limit),
          ...(after ? { after } : {}),
        },
        ctx.token,
        attempt.timeoutMs
      );
      // Only a "too slow" or "too much" answer is worth asking again, lighter.
      if (r.ok || !r.retryLighter) break;
    }
    if (!r.ok) return failed("error", r.problem);

    const conversations = mapConversations(r.json, account, ctx.selfIds);
    return {
      status: {
        id: account.id,
        label,
        state: "ok",
        problem: used.previews
          ? null
          : `Meta would only send a lighter list for this account, so message previews are hidden${used.limit < 25 ? " and only the latest " + used.limit + " conversations are shown" : ""}. Open a conversation to read it.`,
        conversations: conversations.length,
        next: nextCursor(r.json),
        lite: !used.previews,
      },
      conversations,
    };
  } catch {
    return failed("error", "Something went wrong reading this account.");
  }
}

/** Every connected Instagram and Facebook account, read live, newest first. */
export async function readInbox(): Promise<{
  statuses: AccountStatus[];
  conversations: Conversation[];
}> {
  const all = await listAccounts();
  const results = await Promise.all(
    all.filter(isMetaChannel).map((a) => readAccount(a, all))
  );
  return {
    statuses: results.map((r) => r.status),
    conversations: sortNewestFirst(results.flatMap((r) => r.conversations)),
  };
}

export type MorePage =
  | { ok: true; conversations: Conversation[]; next: string | null; lite: boolean }
  | { ok: false; status: number; problem: string };

/**
 * The next page of one account's conversations, for "Load more" / "Load
 * all". The account comes from OUR registry and the cursor is checked, so the
 * browser cannot widen what is asked of Meta or borrow another brand's key.
 */
export async function readMore(
  accountId: unknown,
  after: unknown,
  lite: boolean
): Promise<MorePage> {
  if (typeof accountId !== "string" || !isSafeCursor(after)) {
    return { ok: false, status: 400, problem: "That request for more conversations is not valid." };
  }
  const all = await listAccounts();
  const account = all.find((a) => a.id === accountId);
  if (!account || !isMetaChannel(account)) {
    return { ok: false, status: 404, problem: "That account is not connected." };
  }
  const page = await readAccount(account, all, after, lite ? 1 : 0);
  if (page.status.state !== "ok") {
    return { ok: false, status: 502, problem: page.status.problem ?? "Could not load more from Meta." };
  }
  return {
    ok: true,
    conversations: page.conversations,
    next: page.status.next,
    lite: page.status.lite,
  };
}

/* ── One thread ──────────────────────────────────────────────────────────── */

type OpenThread =
  | {
      ok: true;
      account: StoredAccount;
      token: string;
      messages: InboxMessage[];
      peer: Peer | null;
      window: ReplyWindow;
    }
  | { ok: false; status: number; problem: string };

async function openThread(threadId: unknown, now: Date): Promise<OpenThread> {
  const ids = decodeThreadId(threadId);
  if (!ids) return { ok: false, status: 400, problem: "That conversation link is not valid." };

  const all = await listAccounts();
  const account = all.find((a) => a.id === ids.accountId);
  if (!account || !isMetaChannel(account)) {
    return { ok: false, status: 404, problem: "That account is not connected." };
  }

  const ctx = await accountContext(account, all);
  if (!ctx.ok) return { ok: false, status: 503, problem: ctx.problem };

  let r: GraphResult = { ok: false, problem: "Nothing was asked.", retryLighter: false };
  for (const limit of THREAD_LIMITS) {
    r = await graphGet(
      ids.metaConversationId,
      { fields: `participants,messages.limit(${limit}){${MESSAGE_FIELDS}}` },
      ctx.token
    );
    if (r.ok || !r.retryLighter) break;
  }
  if (!r.ok) return { ok: false, status: 502, problem: r.problem };

  const threadId_ = `${ids.accountId}~${ids.metaConversationId}`;
  const messages = mapThread(r.json, threadId_, ctx.selfIds);
  return {
    ok: true,
    account,
    token: ctx.token,
    messages,
    peer: peerOf(r.json, ctx.selfIds),
    window: replyWindow(lastCustomerAt(messages), now),
  };
}

export type ThreadView =
  | { ok: true; messages: InboxMessage[]; window: { open: boolean; text: string } }
  | { ok: false; status: number; problem: string };

/** What the screen needs for one open thread. The token never leaves here. */
export async function readThreadForStaff(threadId: unknown): Promise<ThreadView> {
  const t = await openThread(threadId, new Date());
  if (!t.ok) return t;
  return {
    ok: true,
    messages: t.messages,
    window: {
      open: t.window.open,
      text: windowExplanation(t.window, t.account.channel as ChannelKey),
    },
  };
}

/* ── Replying ────────────────────────────────────────────────────────────── */

export type SendOutcome =
  | { kind: "sent" }
  | { kind: "switched_off" }
  | { kind: "window_closed"; explanation: string }
  | { kind: "refused"; status: number; problem: string };

/**
 * Send a staff reply on a live thread.
 *
 * The recipient is read from the conversation ON META with the account's own
 * token — the browser names a thread, never a person. The 24-hour window is
 * checked against the thread as Meta has it right now.
 */
export async function sendOnThread(
  threadId: unknown,
  text: string,
  live: boolean
): Promise<SendOutcome> {
  const t = await openThread(threadId, new Date());
  if (!t.ok) return { kind: "refused", status: t.status, problem: t.problem };
  if (!t.peer) {
    return { kind: "refused", status: 409, problem: "Could not tell who the customer is in this conversation." };
  }
  if (!t.window.open) {
    return { kind: "window_closed", explanation: windowExplanation(t.window, t.account.channel as ChannelKey) };
  }
  if (!live) return { kind: "switched_off" };

  const adapter = t.account.channel === "instagram" ? instagramAdapter : messengerAdapter;
  const result = await adapter.send(
    { accountId: t.account.id, toExternalId: t.peer.id, text },
    t.token
  );
  return result.ok
    ? { kind: "sent" }
    : { kind: "refused", status: 502, problem: `Meta did not accept it: ${result.error}` };
}
