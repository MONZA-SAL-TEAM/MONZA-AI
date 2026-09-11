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
 *
 * ── Instagram is slow, and must not hold Facebook up ────────────────────────
 * On 2026-09-10 @voyahlebanon's conversation list answered "reduce the amount
 * of data" with previews, then ran past 12 s without them, while the Voyah
 * Page's list came back in about two seconds. So the page gives each account a
 * short budget; an account that runs out is handed to the browser ("deferred"),
 * which fetches its first page through /api/channels/more with a far longer
 * budget — Facebook is on screen meanwhile.
 */

import { channelToken, metaAppSecret, metaAppSecretsMap } from "@/lib/env";
import { parseMetaAppSecrets } from "@/lib/channels/meta-signature";
import { listAccounts, readDeliveries, type StoredAccount } from "@/lib/channels/store";
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
  metaErrorDetail,
  nextCursor,
  pageIdFor,
  peerOf,
  readPageInfo,
  sortNewestFirst,
  summariseAppSubscriptions,
  summariseDeliveries,
  summariseDebugToken,
  summariseSubscribedApps,
  type AccountState,
  type AccountStatus,
  type Peer,
  type ScopeWant,
} from "@/lib/channels/live-map";

const GRAPH = "https://graph.facebook.com/v21.0";
/** A single small call: the Page's own token and linked Instagram account. */
const TIMEOUT_MS = 12_000;
/** Opening one thread. Inside the thread route's 60 s. */
const THREAD_TIMEOUT_MS = 20_000;
/** How long the inbox page waits for one account before handing it to the browser. */
const RENDER_BUDGET_MS = 10_000;
/** How long "Load more" (or a handed-over first page) keeps trying, inside the route's 60 s. */
const MORE_BUDGET_MS = 50_000;
const MESSAGE_FIELDS = "id,created_time,from,message";

/**
 * How the conversation list is asked for, fullest first. When Meta is too
 * slow, or answers "reduce the amount of data", the next, lighter question is
 * tried: without each conversation's latest message, then fewer rows, then a
 * bare list without names (names then appear when a conversation is opened).
 */
const LIST_ATTEMPTS = [
  {
    fields: `id,updated_time,participants,messages.limit(1){${MESSAGE_FIELDS}}`,
    limit: 25,
    previews: true,
    names: true,
    timeoutMs: 20_000,
  },
  { fields: "id,updated_time,participants", limit: 25, previews: false, names: true, timeoutMs: 20_000 },
  { fields: "id,updated_time,participants", limit: 10, previews: false, names: true, timeoutMs: 20_000 },
  { fields: "id,updated_time", limit: 25, previews: false, names: false, timeoutMs: 20_000 },
] as const;

type ListAttempt = (typeof LIST_ATTEMPTS)[number];

/** Messages shown per thread, fullest first. Instagram only details the latest 20. */
const THREAD_LIMITS = [20, 8] as const;

type GraphResult =
  | { ok: true; json: unknown }
  /** meta: Meta's own code/subcode/message, for the staff-only diagnosis. */
  | { ok: false; problem: string; retryLighter: boolean; meta?: string | null };

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
      ? {
          ok: false,
          problem: graphProblem(json, res.status),
          retryLighter: isTooMuchData(json),
          meta: metaErrorDetail(json),
        }
      : { ok: true, json };
  } catch (e) {
    // "Took too long" and "could not connect" need different fixes, so they
    // must not read the same on screen — and how long it waited is the clue.
    const timedOut =
      e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return {
      ok: false,
      problem: timedOut
        ? `Meta took too long to answer (over ${Math.round(timeoutMs / 1000)} s).`
        : "Could not reach Meta just now.",
      retryLighter: timedOut,
      meta: null,
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
  | { ok: false; state: "no_token" | "no_page" | "error"; problem: string };

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

function partialNote(used: ListAttempt): string | null {
  if (used.previews) return null;
  if (!used.names) {
    return "Meta sends this account only a bare list, so names and previews appear when you open a conversation.";
  }
  return `Meta sends this account a lighter list, so message previews are hidden${
    used.limit < 25 ? ` and pages are ${used.limit} conversations long` : ""
  }. Open a conversation to read it.`;
}

/**
 * One page of one account's conversations.
 *
 *   after    Meta's cursor for a later page ("Load more"), or null for page one
 *   startAt  skip list shapes already known to be too heavy for this account
 *   budgetMs how long to keep trying; on the page itself this is short, and an
 *            account that runs out is returned as "deferred" for the browser
 */
async function readAccount(
  account: StoredAccount,
  all: readonly StoredAccount[],
  opts: { after?: string | null; startAt?: number; budgetMs: number; deferIfSlow: boolean }
): Promise<{ status: AccountStatus; conversations: Conversation[] }> {
  const label = accountLabel(account);
  const result = (
    state: AccountState,
    problem: string | null,
    extra: Partial<AccountStatus> = {}
  ) => ({
    status: { id: account.id, label, state, problem, conversations: 0, next: null, lite: false, ...extra },
    conversations: [] as Conversation[],
  });

  try {
    const ctx = await accountContext(account, all);
    if (!ctx.ok) return result(ctx.state, ctx.problem);

    const platform = account.channel === "instagram" ? "instagram" : "messenger";
    const path = `${ctx.pageId}/conversations`;
    const attempts = LIST_ATTEMPTS.slice(Math.min(opts.startAt ?? 0, LIST_ATTEMPTS.length - 1));

    const started = Date.now();
    let r: GraphResult = { ok: false, problem: "Nothing was asked.", retryLighter: false };
    let used: ListAttempt = attempts[0];
    let outOfTime = false;
    for (const attempt of attempts) {
      const remaining = opts.budgetMs - (Date.now() - started);
      if (remaining < 1_500) {
        outOfTime = true;
        break;
      }
      used = attempt;
      r = await graphGet(
        path,
        {
          platform,
          fields: attempt.fields,
          limit: String(attempt.limit),
          ...(opts.after ? { after: opts.after } : {}),
        },
        ctx.token,
        Math.min(attempt.timeoutMs, remaining)
      );
      // Only a "too slow" or "too much" answer is worth asking again, lighter.
      if (r.ok || !r.retryLighter) break;
    }

    if (!r.ok) {
      // Still being asked something lighter when the page ran out of patience:
      // not broken, just slow — the browser takes it from here.
      if (opts.deferIfSlow && (outOfTime || r.retryLighter)) {
        return result("deferred", "Loading from Meta…", { lite: true });
      }
      return result("error", r.problem);
    }

    const conversations = mapConversations(r.json, account, ctx.selfIds);
    return {
      status: {
        id: account.id,
        label,
        state: "ok",
        problem: partialNote(used),
        conversations: conversations.length,
        next: nextCursor(r.json),
        lite: !used.previews,
      },
      conversations,
    };
  } catch {
    return result("error", "Something went wrong reading this account.");
  }
}

/** Every connected Instagram and Facebook account, read live, newest first. */
export async function readInbox(): Promise<{
  statuses: AccountStatus[];
  conversations: Conversation[];
}> {
  const all = await listAccounts();
  const results = await Promise.all(
    all
      .filter(isMetaChannel)
      .map((a) => readAccount(a, all, { budgetMs: RENDER_BUDGET_MS, deferIfSlow: true }))
  );
  return {
    statuses: results.map((r) => r.status),
    conversations: sortNewestFirst(results.flatMap((r) => r.conversations)),
  };
}

export type MorePage =
  | {
      ok: true;
      conversations: Conversation[];
      next: string | null;
      lite: boolean;
      /** A partial-load note ("previews hidden"), or null. */
      note: string | null;
    }
  | { ok: false; status: number; problem: string };

/**
 * A page of one account's conversations for the browser: the next page for
 * "Load more" / "Load all", or — with no cursor — the first page of an account
 * the inbox page could not wait for. The account comes from OUR registry and
 * the cursor is checked, so the browser cannot widen what is asked of Meta or
 * borrow another brand's key.
 */
export async function readMore(
  accountId: unknown,
  after: unknown,
  lite: boolean
): Promise<MorePage> {
  const cursor = after === null || after === undefined || after === "" ? null : after;
  if (typeof accountId !== "string" || (cursor !== null && !isSafeCursor(cursor))) {
    return { ok: false, status: 400, problem: "That request for more conversations is not valid." };
  }
  const all = await listAccounts();
  const account = all.find((a) => a.id === accountId);
  if (!account || !isMetaChannel(account)) {
    return { ok: false, status: 404, problem: "That account is not connected." };
  }
  const page = await readAccount(account, all, {
    after: cursor as string | null,
    startAt: lite ? 1 : 0,
    budgetMs: MORE_BUDGET_MS,
    deferIfSlow: false,
  });
  if (page.status.state !== "ok") {
    return { ok: false, status: 502, problem: page.status.problem ?? "Could not load more from Meta." };
  }
  return {
    ok: true,
    conversations: page.conversations,
    next: page.status.next,
    lite: page.status.lite,
    note: page.status.problem,
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
      ctx.token,
      THREAD_TIMEOUT_MS
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

/* ── Diagnosis ───────────────────────────────────────────────────────────── */

export interface DiagnoseStep {
  step: string;
  ms: number;
  ok: boolean;
  /** What Meta answered, in brief: a row count, or its error. Never a key. */
  detail: string;
}

export type Diagnosis =
  | { ok: true; account: string; steps: DiagnoseStep[] }
  | { ok: false; status: number; problem: string };

function briefly(json: unknown): string {
  const root = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
  if (root && Array.isArray(root.data)) {
    const more = nextCursor(json) ? ", more available" : "";
    return `${root.data.length} row(s)${more}`;
  }
  return root ? `fields: ${Object.keys(root).join(", ")}` : "empty answer";
}

/**
 * Time the smallest possible questions for one account, one at a time, so a
 * slow or refused Instagram listing can be told apart from a slow token, a
 * slow Page, or an Instagram account Meta will not let us read at all
 * (2026-09-10: every Instagram list shape timed out while Facebook took ~2 s).
 */
export async function diagnoseAccount(accountId: unknown): Promise<Diagnosis> {
  if (typeof accountId !== "string") {
    return { ok: false, status: 400, problem: "Say which account to check." };
  }
  const all = await listAccounts();
  const account = all.find((a) => a.id === accountId);
  if (!account || !isMetaChannel(account)) {
    return { ok: false, status: 404, problem: "That account is not connected." };
  }

  const steps: DiagnoseStep[] = [];

  // FIRST, because it costs nothing and settles the direction of the fault:
  // has Meta ever posted a webhook naming this account? Our own record answers
  // it without a token, an app secret or a call to Meta — and "nothing ever
  // arrived" and "it arrived and we lost it" have no fix in common.
  const expectedObject = account.channel === "instagram" ? "instagram" : "page";
  const td = Date.now();
  const deliveries = await readDeliveries();
  steps.push({
    step: "Webhooks Meta has actually delivered",
    ms: Date.now() - td,
    ok: deliveries.ok && deliveries.rows.some((r) => r.ids.includes(account.externalId)),
    detail: deliveries.ok
      ? summariseDeliveries(deliveries.rows, account.externalId, expectedObject)
      : `The delivery record could not be read, so this is unknown rather than empty: ${deliveries.error}`,
  });

  const t0 = Date.now();
  const ctx = await accountContext(account, all);
  steps.push({
    step: "Page key and linked Instagram account",
    ms: Date.now() - t0,
    ok: ctx.ok,
    detail: ctx.ok ? "ok" : ctx.problem,
  });
  if (!ctx.ok) return { ok: true, account: account.id, steps };

  const timed = async (
    step: string,
    path: string,
    params: Record<string, string>,
    timeoutMs: number
  ) => {
    const t = Date.now();
    const r = await graphGet(path, params, ctx.token, timeoutMs);
    const detail = r.ok ? briefly(r.json) : r.meta ? `${r.problem} [Meta: ${r.meta}]` : r.problem;
    steps.push({ step, ms: Date.now() - t, ok: r.ok, detail });
  };

  // What the brand's access key actually carries, and for which accounts. Meta
  // answers this only to the app that issued the key, so it is asked with that
  // app's own id and secret; neither the key nor the secret is ever returned.
  const envToken = channelToken(account.tokenEnv);
  const secret = account.appId
    ? parseMetaAppSecrets(metaAppSecretsMap(), metaAppSecret()).find((s) => s.appId === account.appId)
    : undefined;
  const wants: ScopeWant[] = [
    ...(account.channel === "instagram"
      ? [
          { scope: "instagram_manage_messages", id: account.externalId },
          { scope: "instagram_basic", id: account.externalId },
        ]
      : []),
    { scope: "pages_messaging", id: ctx.pageId },
    { scope: "pages_manage_metadata", id: ctx.pageId },
    { scope: "pages_read_engagement", id: ctx.pageId },
    { scope: "pages_show_list", id: ctx.pageId },
  ];
  const tk = Date.now();
  if (!envToken || !secret || !account.appId) {
    steps.push({
      step: "Access key permissions",
      ms: 0,
      ok: false,
      detail: "Skipped: this account's app id or app secret is not configured.",
    });
  } else {
    const r = await graphGet("debug_token", { input_token: envToken }, `${account.appId}|${secret.secret}`, 10_000);
    steps.push({
      step: "Access key permissions",
      ms: Date.now() - tk,
      ok: r.ok,
      detail: r.ok ? summariseDebugToken(r.json, wants) : r.meta ? `${r.problem} [Meta: ${r.meta}]` : r.problem,
    });
  }

  // Meta's own record of where this app's webhooks go and which fields are on,
  // and which apps this Page really sends its events to — the dashboard's
  // product switcher is unreliable, so these are read from the API instead.
  const readWith = async (
    step: string,
    path: string,
    token: string,
    summarise: (json: unknown) => string
  ) => {
    const t = Date.now();
    const r = await graphGet(path, {}, token, 10_000);
    const detail = r.ok ? summarise(r.json) : r.meta ? `${r.problem} [Meta: ${r.meta}]` : r.problem;
    steps.push({ step, ms: Date.now() - t, ok: r.ok, detail });
  };
  if (secret && account.appId) {
    await readWith(
      "Meta's record of this app's webhooks",
      `${account.appId}/subscriptions`,
      `${account.appId}|${secret.secret}`,
      (json) => summariseAppSubscriptions(json, ["page", "instagram"])
    );
  }
  await readWith("Apps this Page sends events to", `${ctx.pageId}/subscribed_apps`, ctx.token, (json) =>
    summariseSubscribedApps(json, account.appId)
  );

  await timed(
    "Facebook conversations: 1 row, id only",
    `${ctx.pageId}/conversations`,
    { platform: "messenger", fields: "id", limit: "1" },
    10_000
  );
  if (account.channel === "instagram") {
    await timed("Instagram profile basics", account.externalId, { fields: "username" }, 10_000);
    await timed(
      "Instagram conversations: 1 row, id only",
      `${ctx.pageId}/conversations`,
      { platform: "instagram", fields: "id", limit: "1" },
      35_000
    );
  }
  return { ok: true, account: account.id, steps };
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
