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
  instagramApiFlavour,
  summariseAppSubscriptions,
  summariseDeliveries,
  summariseDebugToken,
  summariseInstagramIdentity,
  summariseSubscribedApps,
  type AccountState,
  type DeliveryRecord,
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

/** One call to Meta. Named so the diagnosis can be handed a fake one in a test
 *  without the production path gaining an injection point it never uses. */
export type GraphFn = (
  path: string,
  params: Record<string, string>,
  token: string,
  timeoutMs: number
) => Promise<GraphResult>;

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
  /** Meta's OTHER numeric id for the same Instagram account — what the app
   *  dashboard's rate-limit card displays. Diagnosis only; never an identity. */
  igLegacyId: string | null;
  igUsername: string | null;
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
async function pageInfo(pageId: string, envToken: string, graph: GraphFn = graphGet): Promise<PageInfo> {
  const key = `${pageId}:${envToken.length}:${envToken.slice(-6)}`;
  // The cache is keyed on the real credential, so a test graph must never read
  // from it or write to it — otherwise one test's fake Page leaks into the next.
  const live = graph === graphGet;
  const hit = live ? pageCache.get(key) : undefined;
  if (hit && hit.until > Date.now()) return hit;

  // The expanded read carries ig_id and username, which the diagnosis needs to
  // stop the dashboard's OTHER Instagram id from reading as a mismatch. It is
  // asked on the INBOX's hot path, so a Meta version or permission that rejects
  // the sub-field syntax must not cost us the linked-account id and take the
  // Instagram inbox down with it. On any failure, ask the plain question the
  // code asked before this field was added.
  let r = await graph(
    pageId,
    { fields: "access_token,instagram_business_account{id,ig_id,username}" },
    envToken,
    TIMEOUT_MS
  );
  if (!r.ok) {
    r = await graph(pageId, { fields: "access_token,instagram_business_account" }, envToken, TIMEOUT_MS);
  }
  const read = r.ok
    ? readPageInfo(r.json)
    : { token: null, igId: null, igLegacyId: null, igUsername: null };
  const info: PageInfo = {
    token: read.token ?? envToken,
    igId: read.igId,
    igLegacyId: read.igLegacyId,
    igUsername: read.igUsername,
    until: Date.now() + PAGE_CACHE_MS,
  };
  if (r.ok && live) pageCache.set(key, info); // a failure is retried next time, not remembered
  return info;
}

type AccountContext =
  | { ok: true; pageId: string; token: string; selfIds: string[] }
  | { ok: false; state: "no_token" | "no_page" | "error"; problem: string };

async function accountContext(
  account: StoredAccount,
  all: readonly StoredAccount[],
  graph: GraphFn = graphGet,
  tokenFor: (env: string) => string | null = channelToken
): Promise<AccountContext> {
  const pageId = pageIdFor(account, all);
  if (!pageId) {
    return {
      ok: false,
      state: "no_page",
      problem: "No Facebook Page of the same brand is registered, so this Instagram account cannot be read.",
    };
  }

  const envToken = tokenFor(account.tokenEnv);
  if (!envToken) {
    return { ok: false, state: "no_token", problem: "The access key for this account has not been added yet." };
  }

  const info = await pageInfo(pageId, envToken, graph);

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

/**
 * Four outcomes, never two. A boolean collapses "we asked and the answer was
 * no" into the same value as "we could not ask", and those need opposite next
 * actions — the first is a fault to fix, the second is a fact still unknown.
 */
export type CheckStatus = "pass" | "fail" | "skipped" | "unknown";

export interface DiagnoseStep {
  step: string;
  ms: number;
  status: CheckStatus;
  /** What Meta answered, in brief: a row count, or its error. Never a key. */
  detail: string;
}

export type Diagnosis =
  | {
      ok: true;
      account: string;
      steps: DiagnoseStep[];
      /** True when the time budget ran out before every check was attempted.
       *  The steps already gathered are returned rather than discarded. */
      truncated: boolean;
    }
  | { ok: false; status: number; problem: string };

/**
 * Everything the diagnosis reaches outside itself. Production passes the real
 * implementations; a test passes fakes, which is the only way to assert that a
 * refused Page token still returns the checks that do not depend on it.
 */
export interface DiagnoseIO {
  accounts: () => Promise<StoredAccount[]>;
  deliveries: () => Promise<
    { ok: true; rows: DeliveryRecord[]; limit: number } | { ok: false; error: string }
  >;
  graph: GraphFn;
  tokenFor: (envName: string) => string | null;
  secretFor: (appId: string | null) => string | null;
  now: () => number;
  budgetMs: number;
}

/** Inside the route's 60 s, leaving room to serialise what was gathered. */
const DIAGNOSE_BUDGET_MS = 45_000;
/** Below this, a network step is not worth starting: it would only time out. */
const MIN_STEP_MS = 1_500;

export function liveDiagnoseIO(): DiagnoseIO {
  return {
    accounts: listAccounts,
    deliveries: readDeliveries,
    graph: graphGet,
    tokenFor: channelToken,
    secretFor: (appId) =>
      appId === null
        ? null
        : parseMetaAppSecrets(metaAppSecretsMap(), metaAppSecret()).find((x) => x.appId === appId)
            ?.secret ?? null,
    now: () => Date.now(),
    budgetMs: DIAGNOSE_BUDGET_MS,
  };
}

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
 *
 * Two ordering rules, both learned the hard way:
 *
 *   - Every check that CAN be answered without the Page's token runs first and
 *     runs unconditionally. A refused Page token used to end the diagnosis
 *     before the delivery record, the key's permissions and the app's webhook
 *     subscriptions had been read — hiding the three facts most likely to
 *     explain the refusal behind the refusal itself.
 *   - A shared deadline governs the whole run. One Instagram listing can burn
 *     35 s on its own, and without a budget the route's own timeout would
 *     discard every completed check along with it. Work already done is
 *     returned; what was not attempted says so.
 */
export async function diagnoseAccount(
  accountId: unknown,
  io: DiagnoseIO = liveDiagnoseIO()
): Promise<Diagnosis> {
  if (typeof accountId !== "string") {
    return { ok: false, status: 400, problem: "Say which account to check." };
  }
  const all = await io.accounts();
  const account = all.find((a) => a.id === accountId);
  if (!account || !isMetaChannel(account)) {
    return { ok: false, status: 404, problem: "That account is not connected." };
  }

  const steps: DiagnoseStep[] = [];
  const deadline = io.now() + io.budgetMs;
  let truncated = false;

  const add = (step: string, ms: number, status: CheckStatus, detail: string) =>
    steps.push({ step, ms, status, detail });

  /** Time left for network work, or null when the budget is spent. */
  const budgetLeft = (): number | null => {
    const left = deadline - io.now();
    return left >= MIN_STEP_MS ? left : null;
  };
  const outOfTime = (step: string) => {
    truncated = true;
    add(step, 0, "skipped", "Not attempted: the diagnosis time budget was spent on earlier checks.");
  };

  // ── Checks that need NO Page token, so nothing below can suppress them ────

  // Has Meta ever posted a webhook naming this account? No token, no secret,
  // no call to Meta — and "nothing matching was recorded" and "it arrived and
  // we lost it" have no fix in common.
  const expectedObject = account.channel === "instagram" ? "instagram" : "page";
  const td = io.now();
  const deliveries = await io.deliveries();
  if (!deliveries.ok) {
    add(
      "Webhooks Meta has actually delivered",
      io.now() - td,
      "unknown",
      `The delivery record could not be read, so this is unknown rather than empty: ${deliveries.error}`
    );
  } else {
    const found = deliveries.rows.some((r) => r.ids.includes(account.externalId));
    add(
      "Webhooks Meta has actually delivered",
      io.now() - td,
      // Never "fail": no matching row is not proof Meta sent nothing. The
      // detail spells out the four ways a delivery leaves no row.
      found ? "pass" : "unknown",
      summariseDeliveries(deliveries.rows, account.externalId, expectedObject, deliveries.limit)
    );
  }

  // The Page id comes from the registry, not from Meta, so the permission
  // check below can name the right Page even when Meta will not talk to us.
  const registryPageId = pageIdFor(account, all);

  const envToken = io.tokenFor(account.tokenEnv);
  const secret = io.secretFor(account.appId);
  const appSecretToken = account.appId && secret ? `${account.appId}|${secret}` : null;
  const wants: ScopeWant[] = [
    ...(account.channel === "instagram"
      ? [
          // Both vocabularies, because "NOT granted" on the Facebook-Login
          // names means nothing until you know the key is not an
          // Instagram-Login key carrying the other set.
          { scope: "instagram_manage_messages", id: account.externalId },
          { scope: "instagram_basic", id: account.externalId },
          { scope: "instagram_business_manage_messages", id: account.externalId },
          { scope: "instagram_business_basic", id: account.externalId },
        ]
      : []),
    ...(registryPageId
      ? [
          { scope: "pages_messaging", id: registryPageId },
          { scope: "pages_manage_metadata", id: registryPageId },
          { scope: "pages_read_engagement", id: registryPageId },
          { scope: "pages_show_list", id: registryPageId },
        ]
      : []),
  ];

  // What the brand's access key actually carries, and for which accounts. Meta
  // answers this only to the app that issued the key, so it is asked with that
  // app's own id and secret; neither the key nor the secret is ever returned.
  if (!envToken || !appSecretToken) {
    add(
      "Access key permissions",
      0,
      "skipped",
      !envToken
        ? `Skipped: no value is set for ${account.tokenEnv}.`
        : "Skipped: this account's app id or app secret is not configured."
    );
    add("Which Instagram API this key is for", 0, "skipped", "Skipped: the key's permissions could not be read.");
  } else {
    const left = budgetLeft();
    if (left === null) {
      outOfTime("Access key permissions");
      outOfTime("Which Instagram API this key is for");
    } else {
      const tk = io.now();
      const r = await io.graph("debug_token", { input_token: envToken }, appSecretToken, Math.min(10_000, left));
      add(
        "Access key permissions",
        io.now() - tk,
        r.ok ? "pass" : "unknown",
        r.ok ? summariseDebugToken(r.json, wants) : r.meta ? `${r.problem} [Meta: ${r.meta}]` : r.problem
      );
      // Which of Meta's two Instagram messaging APIs this key belongs to. The
      // Inbox renders from {page-id}/conversations, so the wrong one is a
      // silent empty screen rather than an error anybody would notice.
      if (account.channel === "instagram") {
        if (!r.ok) {
          add("Which Instagram API this key is for", 0, "unknown", "Meta did not answer for this key.");
        } else {
          const flavour = instagramApiFlavour(r.json);
          add(
            "Which Instagram API this key is for",
            0,
            /^Facebook Login/.test(flavour) ? "pass" : "fail",
            flavour
          );
        }
      }
    }
  }

  // Meta's own record of where this app's webhooks go and which fields are on,
  // per object. This separates "the instagram object was never subscribed"
  // from every other cause, and needs only the app's own id and secret — so it
  // must never be gated behind a Page token.
  if (!appSecretToken) {
    add(
      "Meta's record of this app's webhooks",
      0,
      "skipped",
      "Skipped: this account's app id or app secret is not configured."
    );
  } else {
    const left = budgetLeft();
    if (left === null) {
      outOfTime("Meta's record of this app's webhooks");
    } else {
      const t = io.now();
      const r = await io.graph(`${account.appId}/subscriptions`, {}, appSecretToken, Math.min(10_000, left));
      add(
        "Meta's record of this app's webhooks",
        io.now() - t,
        r.ok ? "pass" : "unknown",
        r.ok
          ? summariseAppSubscriptions(r.json, ["page", "instagram"])
          : r.meta
            ? `${r.problem} [Meta: ${r.meta}]`
            : r.problem
      );
    }
  }

  // ── Checks that do need the Page token ──────────────────────────────────
  const ctxLeft = budgetLeft();
  if (ctxLeft === null) {
    outOfTime("Page key and linked Instagram account");
    outOfTime("Page and conversation reads");
    return { ok: true, account: account.id, steps, truncated };
  }

  const t0 = io.now();
  const ctx = await accountContext(account, all, io.graph, io.tokenFor);
  add(
    "Page key and linked Instagram account",
    io.now() - t0,
    ctx.ok ? "pass" : ctx.state === "no_token" || ctx.state === "no_page" ? "skipped" : "fail",
    ctx.ok ? "ok" : ctx.problem
  );
  if (!ctx.ok) {
    // Everything remaining is asked WITH the Page's token, so it cannot be
    // answered. Say which checks were not run and why, rather than ending the
    // list silently and letting the reader assume they passed.
    add(
      "Page and conversation reads",
      0,
      "skipped",
      `Not attempted: these need the Page's own token, which could not be obtained. ${ctx.problem}`
    );
    return { ok: true, account: account.id, steps, truncated };
  }

  const timed = async (step: string, path: string, params: Record<string, string>, timeoutMs: number) => {
    const left = budgetLeft();
    if (left === null) return outOfTime(step);
    const t = io.now();
    const r = await io.graph(path, params, ctx.token, Math.min(timeoutMs, left));
    add(
      step,
      io.now() - t,
      r.ok ? "pass" : "unknown",
      r.ok ? briefly(r.json) : r.meta ? `${r.problem} [Meta: ${r.meta}]` : r.problem
    );
  };

  // Which Instagram account our registry claims, against BOTH ids Meta holds
  // for it. An event naming an id we do not recognise is dropped, silently.
  if (account.channel === "instagram") {
    const info = await pageInfo(ctx.pageId, envToken ?? ctx.token, io.graph);
    add(
      "Instagram id on record vs Meta's two ids",
      0,
      info.igId === null ? "unknown" : info.igId === account.externalId ? "pass" : "fail",
      summariseInstagramIdentity(account.externalId, info.igId, info.igLegacyId, info.igUsername)
    );
  }

  {
    const left = budgetLeft();
    if (left === null) outOfTime("Apps this Page sends events to");
    else {
      const t = io.now();
      const r = await io.graph(`${ctx.pageId}/subscribed_apps`, {}, ctx.token, Math.min(10_000, left));
      add(
        "Apps this Page sends events to",
        io.now() - t,
        r.ok ? "pass" : "unknown",
        r.ok
          ? summariseSubscribedApps(r.json, account.appId)
          : r.meta
            ? `${r.problem} [Meta: ${r.meta}]`
            : r.problem
      );
    }
  }

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
  return { ok: true, account: account.id, steps, truncated };
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
