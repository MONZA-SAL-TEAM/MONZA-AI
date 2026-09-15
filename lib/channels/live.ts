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
import {
  listAccounts,
  readDeliveries,
  readWhatsAppConversations,
  readWhatsAppMessages,
  recordWhatsAppSent,
  type StoredAccount,
} from "@/lib/channels/store";
import {
  mapWhatsAppConversation,
  mapWhatsAppMessage,
  sendWhatsAppMedia,
  sendWhatsAppText,
  uploadWhatsAppMedia,
} from "@/lib/channels/whatsapp";
import {
  checkOutbound,
  isOutboundPathFor,
  linksWanted,
  outboundMediaPath,
  readAttachments,
  safeFilename,
  verifiedType,
  type OutboundKind,
  type StoredAttachment,
} from "@/lib/channels/wa-media";
import {
  captureMedia,
  mediaJobsFromRows,
  readUploaded,
  removeMedia,
  signLinks,
  signUpload,
} from "@/lib/channels/wa-media-store";
import { isOgg } from "@/lib/media/ogg-opus";
import { instagramAdapter, sendInstagramLogin } from "@/lib/channels/instagram";
import { messengerAdapter } from "@/lib/channels/messenger";
import { replyWindow, windowExplanation, type ReplyWindow } from "@/lib/channels/types";
import type { ChannelKey } from "@/lib/domain/types";
import type { Conversation, InboxMessage } from "@/lib/inbox/types";
import {
  accountLabel,
  decodeThreadId,
  encodeThreadId,
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
  readInstagramLoginSelf,
  readPageInfo,
  sortNewestFirst,
  instagramApiFlavour,
  instagramLoginTokenEnv,
  summariseAppSubscriptions,
  summariseDeliveries,
  summariseDebugToken,
  summariseInstagramIdentity,
  summariseInstagramLoginAccount,
  summariseSubscribedApps,
  type AccountState,
  type DeliveryRecord,
  type AccountStatus,
  type Peer,
  type ScopeWant,
} from "@/lib/channels/live-map";

const GRAPH = "https://graph.facebook.com/v21.0";
/** Instagram's own host, for the opt-in Instagram-login diagnosis only. */
const IG_GRAPH = "https://graph.instagram.com/v21.0";
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
  return fetchMeta(url, { Authorization: `Bearer ${token}` }, timeoutMs);
}

/**
 * graph.instagram.com — Meta's OTHER Instagram API, "Instagram API with
 * Instagram login" (rule 37). Used only by the opt-in Instagram-login
 * diagnosis. That host documents the key as an access_token parameter; it goes
 * to Meta over HTTPS only and is never logged or returned.
 */
async function igGraphGet(
  path: string,
  params: Record<string, string>,
  token: string,
  timeoutMs: number = TIMEOUT_MS
): Promise<GraphResult> {
  const url = new URL(`${IG_GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  return fetchMeta(url, {}, timeoutMs);
}

/** The shared half of every Meta call — timeout, JSON, and the error shapes the
 *  screen and the diagnosis read. The two hosts differ only in how the key goes. */
async function fetchMeta(
  url: URL,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<GraphResult> {
  try {
    const res = await fetch(url, {
      headers,
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

/* ── Which route an account is read on ───────────────────────────────────── */

/**
 * WHY TWO ROUTES (Samer, 2026-09-12 — CLAUDE.md rule 49). On Facebook login
 * Meta refuses to list customer conversations at standard access (-2 /
 * 2534084, "too many conversations with users who do not have a role on app").
 * Through Instagram login the same account's conversations list in ~4 s. So a
 * brand whose Instagram-login key is set (META_IG_LOGIN_TOKEN_<BRAND>) reads,
 * opens and answers Instagram through graph.instagram.com; a brand without one
 * stays on the Facebook-login route exactly as before. Facebook Pages never
 * change route.
 */
type InstagramLogin = { ok: true; token: string; selfIds: string[] } | { ok: false; problem: string };

/** Memory only, a few minutes. Keyed on the credential, never persisted. */
const igSelfCache = new Map<string, { selfIds: string[]; until: number }>();

async function instagramLoginRoute(account: StoredAccount): Promise<InstagramLogin | null> {
  if (account.channel !== "instagram") return null;
  const env = instagramLoginTokenEnv(account.brand);
  const token = env ? channelToken(env) : null;
  if (!token) return null;

  const key = `${account.id}:${token.length}:${token.slice(-6)}`;
  const hit = igSelfCache.get(key);
  if (hit && hit.until > Date.now()) return { ok: true, token, selfIds: hit.selfIds };

  const me = await igGraphGet("me", { fields: "id,user_id,username" }, token, TIMEOUT_MS);
  if (!me.ok) return { ok: false, problem: me.problem };
  // A key for another brand's account is refused here, before it reads anything.
  const self = readInstagramLoginSelf(me.json, account.externalId);
  if (!self.ok) return self;
  igSelfCache.set(key, { selfIds: self.selfIds, until: Date.now() + PAGE_CACHE_MS });
  return { ok: true, token, selfIds: self.selfIds };
}

type ReadRoute =
  | {
      ok: true;
      via: "instagram-login" | "facebook-login";
      get: GraphFn;
      listPath: string;
      token: string;
      selfIds: string[];
    }
  | { ok: false; state: "no_token" | "no_page" | "error"; problem: string };

/** The one place that decides an account's route, for listing, opening and replying alike. */
async function readRoute(account: StoredAccount, all: readonly StoredAccount[]): Promise<ReadRoute> {
  const igLogin = await instagramLoginRoute(account);
  if (igLogin) {
    return igLogin.ok
      ? {
          ok: true,
          via: "instagram-login",
          get: igGraphGet,
          listPath: "me/conversations",
          token: igLogin.token,
          selfIds: igLogin.selfIds,
        }
      : { ok: false, state: "error", problem: `Instagram login: ${igLogin.problem}` };
  }
  const ctx = await accountContext(account, all);
  if (!ctx.ok) return ctx;
  return {
    ok: true,
    via: "facebook-login",
    get: graphGet,
    listPath: `${ctx.pageId}/conversations`,
    token: ctx.token,
    selfIds: ctx.selfIds,
  };
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
    const route = await readRoute(account, all);
    if (!route.ok) return result(route.state, route.problem);

    const platform = account.channel === "instagram" ? "instagram" : "messenger";
    const path = route.listPath;
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
      r = await route.get(
        path,
        {
          platform,
          fields: attempt.fields,
          limit: String(attempt.limit),
          ...(opts.after ? { after: opts.after } : {}),
        },
        route.token,
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

    const conversations = mapConversations(r.json, account, route.selfIds);
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
  if (typeof accountId !== "string") {
    return { ok: false, status: 400, problem: "That request for more conversations is not valid." };
  }
  const all = await listAccounts();
  const account = all.find((a) => a.id === accountId);
  // WhatsApp is read from what was stored, not from Meta (lib/channels/whatsapp.ts).
  if (account?.channel === "whatsapp") return readWhatsAppMore(account, cursor);
  if (cursor !== null && !isSafeCursor(cursor)) {
    return { ok: false, status: 400, problem: "That request for more conversations is not valid." };
  }
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

/* ── WhatsApp: stored, so read from the database ─────────────────────────── */

/** WhatsApp conversations per page. The cursor is an offset, "25", "50"… */
const WA_PAGE = 25;
/** Messages shown in a WhatsApp thread — stored, so more than Meta's 20. */
const WA_THREAD_LIMIT = 100;

async function readWhatsAppMore(account: StoredAccount, cursor: unknown): Promise<MorePage> {
  const offset =
    cursor === null ? 0 : typeof cursor === "string" && /^\d{1,6}$/.test(cursor) ? Number(cursor) : -1;
  if (offset < 0) {
    return { ok: false, status: 400, problem: "That request for more conversations is not valid." };
  }
  const r = await readWhatsAppConversations(account.id, offset, WA_PAGE);
  if (!r.ok) {
    console.error(`[channels/whatsapp] list failed: ${r.error}`);
    return { ok: false, status: 502, problem: "Could not read the saved WhatsApp conversations." };
  }
  return {
    ok: true,
    conversations: r.value.map((row) => mapWhatsAppConversation(row, account)),
    next: r.value.length === WA_PAGE ? String(offset + WA_PAGE) : null,
    lite: false,
    note: null,
  };
}

/** How long opening a thread waits for files still being copied out of Meta. */
const THREAD_MEDIA_BUDGET_MS = 12_000;

async function readWhatsAppThread(
  account: StoredAccount,
  conversationId: string,
  now: Date
): Promise<ThreadView> {
  const r = await readWhatsAppMessages(account.id, conversationId, WA_THREAD_LIMIT);
  if (!r.ok) {
    console.error(`[channels/whatsapp] thread failed: ${r.error}`);
    return { ok: false, status: 502, problem: "Could not read this WhatsApp conversation." };
  }
  if (!r.value) return { ok: false, status: 404, problem: "That conversation was not found." };
  let value = r.value;

  // Files the webhook did not manage to copy: try again now, while Meta still has them.
  const waiting = mediaJobsFromRows(value.rows, account, conversationId);
  if (waiting.length > 0) {
    await captureMedia(waiting, THREAD_MEDIA_BUDGET_MS);
    const again = await readWhatsAppMessages(account.id, conversationId, WA_THREAD_LIMIT);
    if (again.ok && again.value) value = again.value;
  }

  const links = await signLinks(linksWanted(value.rows.flatMap((row) => readAttachments(row.attachments))));
  const threadId = encodeThreadId(account.id, conversationId);
  const window = replyWindow(value.lastInboundAt, now);
  return {
    ok: true,
    messages: value.rows.map((row) => mapWhatsAppMessage(row, threadId, links, now.getTime())),
    window: { open: window.open, text: windowExplanation(window, "whatsapp") },
  };
}

/** A file staff attached, already uploaded to our bucket (POST /api/channels/media). */
export interface OutgoingAttachment {
  path: string;
  kind: OutboundKind;
  filename?: string;
  /** Recorded in the inbox: sent as a voice note when it is Ogg/Opus. */
  voice?: boolean;
}

/**
 * A staff reply on a WhatsApp thread. Same gates as Instagram and Facebook, in
 * the same order: the 24-hour window as the database has it, then the send
 * switch, then the key. The recipient is read from OUR stored conversation —
 * the browser names a thread, never a number.
 */
async function sendOnWhatsApp(
  account: StoredAccount,
  conversationId: string,
  text: string,
  live: boolean,
  staffName: string,
  attachment?: OutgoingAttachment
): Promise<SendOutcome> {
  const r = await readWhatsAppMessages(account.id, conversationId, 1);
  if (!r.ok) return { kind: "refused", status: 502, problem: "Could not read this WhatsApp conversation." };
  if (!r.value || r.value.peerExternalId === "") {
    return { kind: "refused", status: 404, problem: "That conversation was not found." };
  }

  const window = replyWindow(r.value.lastInboundAt, new Date());
  if (!window.open) return { kind: "window_closed", explanation: windowExplanation(window, "whatsapp") };
  if (!live) return { kind: "switched_off" };

  const token = channelToken(account.tokenEnv);
  if (!token) {
    return {
      kind: "refused",
      status: 503,
      problem: "The WhatsApp sending key has not been added yet, so nothing was sent.",
    };
  }

  let stored: StoredAttachment | undefined;
  let sent: Awaited<ReturnType<typeof sendWhatsAppText>>;

  if (!attachment) {
    sent = await sendWhatsAppText({ phoneNumberId: account.externalId, to: r.value.peerExternalId, text }, token);
  } else {
    // Only a file uploaded for THIS conversation — never another customer's.
    if (!isOutboundPathFor(attachment.path, account.id, conversationId)) {
      return { kind: "refused", status: 400, problem: "That file does not belong to this conversation." };
    }
    const file = await readUploaded(attachment.path);
    if (!file.ok) {
      return { kind: "refused", status: 404, problem: "The file did not finish uploading — attach it again." };
    }
    // Checked again here: the browser's own check is a courtesy, not a guard.
    const check = checkOutbound(attachment.kind, verifiedType(file.mime, file.bytes), file.bytes.length);
    if (!check.ok) {
      await removeMedia([attachment.path]);
      return { kind: "refused", status: 400, problem: check.problem };
    }
    const voice = check.kind === "audio" && attachment.voice === true && check.mime === "audio/ogg" && isOgg(file.bytes);
    const filename = safeFilename(attachment.filename, check.ext);

    const up = await uploadWhatsAppMedia(
      { phoneNumberId: account.externalId, bytes: file.bytes, mime: check.mime, filename },
      token
    );
    if (!up.ok) {
      await removeMedia([attachment.path]);
      return { kind: "refused", status: 502, problem: up.problem };
    }
    sent = await sendWhatsAppMedia(
      {
        phoneNumberId: account.externalId,
        to: r.value.peerExternalId,
        kind: check.kind,
        mediaId: up.mediaId,
        caption: text || undefined,
        filename,
        voice,
      },
      token
    );
    if (!sent.ok) await removeMedia([attachment.path]);
    stored = {
      kind: check.kind === "document" ? "file" : check.kind,
      mime: check.mime,
      filename,
      size: file.bytes.length,
      path: attachment.path,
      state: "stored",
      ...(voice ? { voice: true } : {}),
    };
  }

  if (!sent.ok) {
    return sent.windowClosed
      ? { kind: "window_closed", explanation: sent.problem }
      : { kind: "refused", status: 502, problem: sent.problem };
  }

  const recorded = await recordWhatsAppSent({
    accountId: account.id,
    brand: account.brand,
    conversationId,
    externalMessageId: sent.externalMessageId,
    text,
    at: new Date().toISOString(),
    staffName,
    attachment: stored,
  });
  // It WENT. Failing to write our copy must not report a failure — a person
  // would send it a second time.
  if (!recorded) console.error("[channels/whatsapp] sent, but the copy could not be recorded");
  return { kind: "sent" };
}

export type UploadGrant =
  | { kind: "ok"; path: string; token: string }
  | { kind: "switched_off" }
  | { kind: "window_closed"; explanation: string }
  | { kind: "refused"; status: number; problem: string };

/**
 * Permission to upload one file for a WhatsApp reply. Every gate the send
 * itself has is checked FIRST — nobody waits for a 16 MB upload that could
 * never be sent — and the place it goes is chosen here, under this
 * conversation, never by the browser.
 */
export async function prepareWhatsAppUpload(
  threadId: unknown,
  file: { kind: unknown; mime: unknown; size: unknown },
  live: boolean
): Promise<UploadGrant> {
  const wa = await whatsappAccountOf(threadId);
  if (!wa) return { kind: "refused", status: 400, problem: "Files can be sent on WhatsApp conversations only, for now." };
  const check = checkOutbound(file.kind, file.mime, file.size);
  if (!check.ok) return { kind: "refused", status: 400, problem: check.problem };

  const r = await readWhatsAppMessages(wa.account.id, wa.id, 1);
  if (!r.ok) return { kind: "refused", status: 502, problem: "Could not read this WhatsApp conversation." };
  if (!r.value) return { kind: "refused", status: 404, problem: "That conversation was not found." };
  const window = replyWindow(r.value.lastInboundAt, new Date());
  if (!window.open) return { kind: "window_closed", explanation: windowExplanation(window, "whatsapp") };
  if (!live) return { kind: "switched_off" };
  if (!channelToken(wa.account.tokenEnv)) {
    return { kind: "refused", status: 503, problem: "The WhatsApp sending key has not been added yet, so nothing was sent." };
  }

  const path = outboundMediaPath(wa.account.id, wa.id, crypto.randomUUID(), check.ext);
  const signed = await signUpload(path);
  if (!signed.ok) {
    return { kind: "refused", status: 503, problem: "Could not prepare the upload — the file store may not be set up yet." };
  }
  return { kind: "ok", path, token: signed.token };
}

/** The WhatsApp account a thread id names, or null for any other channel. */
async function whatsappAccountOf(threadId: unknown): Promise<{ account: StoredAccount; id: string } | null> {
  const ids = decodeThreadId(threadId);
  if (!ids) return null;
  const account = (await listAccounts()).find((a) => a.id === ids.accountId);
  return account?.channel === "whatsapp" ? { account, id: ids.metaConversationId } : null;
}

/* ── One thread ──────────────────────────────────────────────────────────── */

type OpenThread =
  | {
      ok: true;
      account: StoredAccount;
      token: string;
      /** Which route the thread was read on — a reply goes back on the same one. */
      via: "instagram-login" | "facebook-login";
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

  const route = await readRoute(account, all);
  if (!route.ok) return { ok: false, status: 503, problem: route.problem };

  let r: GraphResult = { ok: false, problem: "Nothing was asked.", retryLighter: false };
  for (const limit of THREAD_LIMITS) {
    r = await route.get(
      ids.metaConversationId,
      { fields: `participants,messages.limit(${limit}){${MESSAGE_FIELDS}}` },
      route.token,
      THREAD_TIMEOUT_MS
    );
    if (r.ok || !r.retryLighter) break;
  }
  if (!r.ok) return { ok: false, status: 502, problem: r.problem };

  const threadId_ = `${ids.accountId}~${ids.metaConversationId}`;
  const messages = mapThread(r.json, threadId_, route.selfIds);
  return {
    ok: true,
    account,
    token: route.token,
    via: route.via,
    messages,
    peer: peerOf(r.json, route.selfIds),
    window: replyWindow(lastCustomerAt(messages), now),
  };
}

export type ThreadView =
  | { ok: true; messages: InboxMessage[]; window: { open: boolean; text: string } }
  | { ok: false; status: number; problem: string };

/** What the screen needs for one open thread. The token never leaves here. */
export async function readThreadForStaff(threadId: unknown): Promise<ThreadView> {
  const wa = await whatsappAccountOf(threadId);
  if (wa) return readWhatsAppThread(wa.account, wa.id, new Date());
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
  /** graph.instagram.com, for the opt-in Instagram-login check only. */
  igGraph?: GraphFn;
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
    igGraph: igGraphGet,
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

/**
 * THE INSTAGRAM-LOGIN EXPERIMENT (Samer, 2026-09-12, "Path 1"). Opt-in through
 * ?route=instagram-login; the standard diagnosis above is untouched.
 *
 * The live integration is on Facebook login (rule 39), and there Meta will not
 * list customer conversations at standard access (-2 / 2534084). Meta's
 * Instagram-login docs allow standard access for accounts "you own or manage or
 * have added to your app" without saying whether conversations with people who
 * hold no role come back. This asks exactly that, read-only, with a SEPARATE
 * Instagram-login key under its own env name: the working system-user key is
 * not touched (rule 8) and nothing is subscribed (rule 37).
 */
export async function diagnoseInstagramLogin(
  accountId: unknown,
  io: DiagnoseIO = liveDiagnoseIO()
): Promise<Diagnosis> {
  if (typeof accountId !== "string") {
    return { ok: false, status: 400, problem: "Say which account to check." };
  }
  const all = await io.accounts();
  const account = all.find((a) => a.id === accountId);
  if (!account || account.channel !== "instagram") {
    return { ok: false, status: 404, problem: "That is not a connected Instagram account." };
  }

  const steps: DiagnoseStep[] = [];
  const add = (step: string, ms: number, status: CheckStatus, detail: string) =>
    steps.push({ step, ms, status, detail });
  const deadline = io.now() + io.budgetMs;
  let truncated = false;
  const budgetLeft = (): number | null => {
    const left = deadline - io.now();
    return left >= MIN_STEP_MS ? left : null;
  };
  const failure = (r: { problem: string; meta?: string | null }) =>
    r.meta ? `${r.problem} [Meta: ${r.meta}]` : r.problem;

  const envName = instagramLoginTokenEnv(account.brand);
  const token = envName ? io.tokenFor(envName) : null;
  if (!envName || !token) {
    add(
      "Instagram-login key",
      0,
      "skipped",
      `Skipped: no value is set for ${envName ?? "an Instagram-login key for this brand"}. ` +
        "This check runs only once the account's Instagram-login key is stored under that name."
    );
    return { ok: true, account: account.id, steps, truncated };
  }
  add("Instagram-login key", 0, "pass", `${envName} is set (the value is never shown).`);
  const ig = io.igGraph ?? igGraphGet;

  // Whose key is it? user_id is the professional account's id — the number a
  // webhook carries — so a key for the wrong account is caught before any read.
  const meLeft = budgetLeft();
  if (meLeft === null) {
    truncated = true;
    add("Which Instagram account this key is for", 0, "skipped", "Not attempted: the time budget was spent.");
  } else {
    const t = io.now();
    const me = await ig("me", { fields: "user_id,username" }, token, Math.min(10_000, meLeft));
    if (me.ok) {
      const s = summariseInstagramLoginAccount(me.json, account.externalId);
      add("Which Instagram account this key is for", io.now() - t, s.status, s.detail);
    } else {
      add("Which Instagram account this key is for", io.now() - t, "unknown", failure(me));
    }
  }

  // The question Path 1 exists to answer: does Instagram login list this
  // account's conversations with customers at standard access?
  const convLeft = budgetLeft();
  if (convLeft === null) {
    truncated = true;
    add("Instagram-login conversations: 5 rows, id only", 0, "skipped", "Not attempted: the time budget was spent.");
  } else {
    const t = io.now();
    const conv = await ig(
      "me/conversations",
      { platform: "instagram", fields: "id,updated_time", limit: "5" },
      token,
      Math.min(35_000, convLeft)
    );
    const rows = conv.ok && Array.isArray((conv.json as { data?: unknown } | null)?.data)
      ? ((conv.json as { data: unknown[] }).data.length)
      : 0;
    add(
      "Instagram-login conversations: 5 rows, id only",
      io.now() - t,
      // An empty 200 is not a pass (rule 21): this inbox is full of customers,
      // so "no conversations" reads as a permission filter, not a quiet inbox.
      conv.ok ? (rows > 0 ? "pass" : "unknown") : "unknown",
      conv.ok
        ? rows > 0
          ? `${briefly(conv.json)} — Meta lists this account's conversations through Instagram login.`
          : "Meta answered with an EMPTY list. The inbox has customers, so this reads as a permission filter, not an empty inbox (rule 21)."
        : failure(conv)
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
  live: boolean,
  /** Who pressed Send — shown under the reply in the thread. */
  staffName = "Monza",
  /** A file already uploaded for this conversation. WhatsApp only, for now. */
  attachment?: OutgoingAttachment
): Promise<SendOutcome> {
  const wa = await whatsappAccountOf(threadId);
  if (wa) return sendOnWhatsApp(wa.account, wa.id, text, live, staffName, attachment);
  if (attachment) {
    return { kind: "refused", status: 400, problem: "Files can be sent on WhatsApp conversations only, for now." };
  }
  const t = await openThread(threadId, new Date());
  if (!t.ok) return { kind: "refused", status: t.status, problem: t.problem };
  if (!t.peer) {
    return { kind: "refused", status: 409, problem: "Could not tell who the customer is in this conversation." };
  }
  if (!t.window.open) {
    return { kind: "window_closed", explanation: windowExplanation(t.window, t.account.channel as ChannelKey) };
  }
  if (!live) return { kind: "switched_off" };

  // A thread read through Instagram login is answered through it too: its
  // token and its customer id belong to graph.instagram.com.
  const send =
    t.account.channel !== "instagram"
      ? messengerAdapter.send
      : t.via === "instagram-login"
        ? sendInstagramLogin
        : instagramAdapter.send;
  const result = await send({ accountId: t.account.id, toExternalId: t.peer.id, text }, t.token);
  return result.ok
    ? { kind: "sent" }
    : { kind: "refused", status: 502, problem: `Meta did not accept it: ${result.error}` };
}
