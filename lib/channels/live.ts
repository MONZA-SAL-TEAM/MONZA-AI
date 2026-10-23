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
  readWhatsAppMessagesById,
  recordSentFile,
  recordStaffTurn,
  recordWhatsAppSent,
  type StoredAccount,
  readRecentOutbound,
  type OutboundRecord,
} from "@/lib/channels/store";
import type { CustomerProfile } from "@/lib/inbox/types";
import { adForConversation, adForMetaThread, type AdCard } from "@/lib/channels/ad-creative";
import { cleanParam, renderTemplate } from "@/lib/channels/wa-templates";
import {
  mapWhatsAppConversation,
  mapWhatsAppMessage,
  quoteReplies,
  isAccountLockError,
  sendLockFrom,
  sendLockWords,
  sendWhatsAppMedia,
  summariseHealth,
  type SendLock,
  sendWhatsAppTemplate,
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
  signFor,
  signLinks,
  signUpload,
} from "@/lib/channels/wa-media-store";
import { isOgg } from "@/lib/media/ogg-opus";
import { instagramAdapter, sendInstagramLogin } from "@/lib/channels/instagram";
import { messengerAdapter } from "@/lib/channels/messenger";
import { HUMAN_AGENT_TEXT, humanAgentWindow, replyWindow, windowExplanation, type ReplyWindow } from "@/lib/channels/types";
import type { ChannelKey } from "@/lib/domain/types";
import type { Conversation, InboxMessage } from "@/lib/inbox/types";
import type { SendTarget } from "@/lib/wasales/executor";
import {
  accountLabel,
  decodeThreadId,
  encodeThreadId,
  graphProblem,
  isSafeCursor,
  isTooMuchData,
  lastCustomerAt,
  mapConversations,
  mapCustomerProfile,
  PROFILE_FIELDS,
  mapThread,
  graphTime,
  metaErrorCode,
  metaErrorDetail,
  metaUsagePercent,
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
  isThrottled,
  isTransient,
  messageShapes,
  type MessageShape,
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

/**
 * An opened thread also asks what each message CARRIES — photos, videos, voice
 * notes, files, shared posts, stories (Samer, 2026-09-15: a shared post read
 * "open the app to see it"). Passed through to the screen, never stored (the
 * 2026-09-10 rule for Instagram and Facebook holds).
 *
 * Per channel, because each refuses the other's field names (`story` is
 * Instagram's, `sticker` Messenger's). Explicit attachment fields first, then
 * the bare edge; if Meta refuses both, the thread is read exactly as before —
 * words only — so asking for more can never cost the thread itself.
 */
/**
 * Read against Meta's Message reference (v26, 2026-10-23): `shares` returns
 * nothing unless its sub-fields are named; there is NO `sticker` field on the
 * node (a sticker is an image with `render_as_sticker`), and asking for an
 * unknown field fails the whole read with #100 — so `sticker` is gone;
 * `is_unsupported` is the node's own flag for a message Meta passes nothing
 * on for, and `story` holds mentions and replies. The explicit level names
 * everything; the bare level asks the edges plainly, for a route that refuses
 * a sub-field.
 */
function richMessageFields(channel: string, explicit: boolean): string {
  const attachments = explicit ? "attachments{id,mime_type,name,size,image_data,video_data,file_url}" : "attachments";
  const shares = explicit ? "shares{link,name,description,id}" : "shares";
  const flag = explicit ? ",is_unsupported" : "";
  return channel === "instagram"
    ? `${MESSAGE_FIELDS}${flag},${attachments},${shares},story`
    : `${MESSAGE_FIELDS}${flag},${attachments},${shares}`;
}

/** Which richer ask last worked per account and route, so a refused one is not
 *  repeated on every 15-second refresh. Memory only, a few minutes. `detail`
 *  is Meta's refusal, kept so the screen can say why words only. */
const richFieldsWorks = new Map<string, { level: number; until: number; detail?: string | null }>();
const RICH_FIELDS_MEMORY_MS = 10 * 60_000;
/** All the asks for one thread share this; the route itself stops at 60 s (two words-only asks may follow). */
const THREAD_BUDGET_MS = 40_000;
/** The least a words-only ask is given, so a slow Meta still answers the thread. */
const THREAD_LAST_ASK_MS = 5_000;

/** Level 0: what the messages carry, named field by field. 1: the bare attachment edge. 2: words only. */
type ThreadLevel = 0 | 1 | 2;
const WORDS_ONLY: ThreadLevel = 2;

export function threadFields(channel: string, level: ThreadLevel): string {
  return level === 0 ? richMessageFields(channel, true) : level === 1 ? richMessageFields(channel, false) : MESSAGE_FIELDS;
}

/** One ask of Meta for a thread, as the diagnosis reports it: never a key, never a word. */
export interface ThreadAskRecord {
  level: ThreadLevel;
  limit: number;
  ms: number;
  status: "ok" | "slow" | "refused" | "throttled" | "transient";
  /** Meta's code / subcode / message on a refusal (metaErrorDetail), else the plain problem. */
  detail: string | null;
}

/**
 * The asks for one thread, in order, within THREAD_BUDGET_MS: what the messages
 * carry at the full size; the same at the smaller size when Meta was slow; the
 * bare attachment edge when the named fields were refused; words only last.
 * Until 2026-10-23 one slow answer dropped straight to words only, and the
 * screen then showed "open the app to see it" under every photo and file in
 * the chat (Samer) — now the smaller rich ask comes first, and a thread read
 * without its files says so (`level`), so the screen keeps what it had.
 */
export interface ThreadAsked {
  r: GraphResult;
  level: ThreadLevel;
  /** How many messages the answer holds at most — fewer than the full page means the screen must MERGE, not replace. */
  limit: number;
  /** Meta's answer to the last rich ask that failed (codes and words, never a key). */
  richProblem: string | null;
  /** When words-only is remembered for the account: until when, and why. */
  rememberedUntil: number | null;
}

/** Exported for its tests, which hand it a scripted route; production calls it through readMetaThread and diagnoseThread. */
export async function askThread(
  route: { get: GraphFn; token: string },
  conversationId: string,
  channel: string,
  memoryKey: string,
  record: (ask: ThreadAskRecord) => void = () => {}
): Promise<ThreadAsked> {
  const started = Date.now();
  const remembered = richFieldsWorks.get(memoryKey);
  const live = remembered && remembered.until > started ? remembered : null;
  let level: ThreadLevel = live ? (live.level as ThreadLevel) : 0;
  let r: GraphResult = { ok: false, problem: "Nothing was asked.", retryLighter: false };
  let limit: number = THREAD_LIMITS[0];
  let richProblem: string | null = live?.level === WORDS_ONLY ? (live.detail ?? null) : null;
  let refusedRich = 0;
  while (level <= WORDS_ONLY) {
    let refused = false;
    for (const size of THREAD_LIMITS) {
      const left = THREAD_BUDGET_MS - (Date.now() - started);
      // Out of budget: a richer ask waits for the next refresh; a SECOND words-only ask is not made either.
      if (left < THREAD_LAST_ASK_MS && (level < WORDS_ONLY || size !== THREAD_LIMITS[0])) break;
      limit = size;
      const t0 = Date.now();
      r = await route.get(
        conversationId,
        { fields: `participants,messages.limit(${size}){${threadFields(channel, level)}}` },
        route.token,
        Math.max(THREAD_LAST_ASK_MS, Math.min(THREAD_TIMEOUT_MS, left))
      );
      record({
        level,
        limit: size,
        ms: Date.now() - t0,
        status: r.ok ? "ok" : r.throttled ? "throttled" : r.retryLighter ? "slow" : r.transient ? "transient" : "refused",
        detail: r.ok ? null : (r.meta ?? r.problem),
      });
      if (r.ok) {
        if (level < WORDS_ONLY) {
          // Remembered only when the richer ask was REFUSED, so a hiccup never fixes the account below its best.
          if (level === 0 || refusedRich > 0) richFieldsWorks.set(memoryKey, { level, until: Date.now() + RICH_FIELDS_MEMORY_MS });
          return { r, level, limit: size, richProblem, rememberedUntil: null };
        }
        if (refusedRich >= 2) {
          // Both rich asks refused outright: words only for a while, not on every 15-second refresh.
          console.warn(`[channels/thread] ${memoryKey}: Meta refused the attachment fields; reading words only`);
          const until = Date.now() + RICH_FIELDS_MEMORY_MS;
          richFieldsWorks.set(memoryKey, { level: WORDS_ONLY, until, detail: richProblem });
          return { r, level, limit: size, richProblem, rememberedUntil: until };
        }
        return { r, level, limit: size, richProblem, rememberedUntil: live?.level === WORDS_ONLY ? live.until : null };
      }
      // Meta's rate limit refuses every ask for a moment: stop here, remember nothing, keep the screen.
      if (r.throttled) return { r, level: WORDS_ONLY, limit: size, richProblem, rememberedUntil: null };
      if (level < WORDS_ONLY) richProblem = r.meta ?? r.problem;
      // Slow or a hiccup: the smaller size next. Only an answer naming the fields is a refusal.
      if (!r.retryLighter && !r.transient) {
        refused = true;
        break;
      }
    }
    if (refused && level < WORDS_ONLY) refusedRich++;
    level = (level + 1) as ThreadLevel;
  }
  return { r, level: WORDS_ONLY, limit, richProblem, rememberedUntil: null };
}

/** The short sentence under a thread whose files could not be read this time. */
export function attachmentsNote(channel: string, richProblem: string | null, rememberedUntil: number | null): string {
  const who = channel === "instagram" ? "Instagram" : "Facebook";
  const why = richProblem ? ` (${richProblem.slice(0, 120)})` : "";
  if (rememberedUntil !== null) {
    const at = new Date(rememberedUntil).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Beirut" });
    return `${who} refused the attachment fields${why} — words only until ${at}; what was shown before is kept.`;
  }
  return `Photos and files could not be read from ${who} this time${why} — what was shown before is kept, and the next refresh tries again.`;
}

type GraphResult =
  /** usage: Meta's rate-limit use in percent, from its headers (metaUsagePercent), when it sent any. */
  | { ok: true; json: unknown; usage?: number | null }
  /** meta: Meta's own code/subcode/message, for the staff-only diagnosis. throttled: Meta's rate limit, a moment's
   *  wait. transient: Meta's own hiccup or no answer at all — says nothing about what was asked. */
  | { ok: false; problem: string; retryLighter: boolean; meta?: string | null; throttled?: boolean; transient?: boolean };

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
          throttled: isThrottled(json, res.status),
          transient: isTransient(json, res.status),
        }
      : { ok: true, json, usage: metaUsagePercent((name) => res.headers.get(name)) };
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
      transient: !timedOut,
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

  // A reply to a message older than the rows read: those few are read too, so the quote can show them.
  const have = new Set(value.rows.map((r) => r.external_message_id).filter(Boolean));
  const wanted = [...new Set(value.rows.map((r) => r.reply_to).filter((x): x is string => Boolean(x) && !have.has(x)))];
  const [olderRows, ad] = await Promise.all([readWhatsAppMessagesById(account.id, conversationId, wanted), adForConversation(conversationId)]);
  const links = await signLinks(linksWanted([...value.rows, ...olderRows].flatMap((row) => readAttachments(row.attachments))));
  const threadId = encodeThreadId(account.id, conversationId);
  const window = replyWindow(value.lastInboundAt, now);
  const older = olderRows.map((row) => mapWhatsAppMessage(row, threadId, links, now.getTime()));
  const messages = quoteReplies(value.rows.map((row) => mapWhatsAppMessage(row, threadId, links, now.getTime())), older);
  // Meta's account lock is account-wide: read from the account's recent sends, never this thread's alone.
  const lock = await accountSendLock(account.id, now.getTime());
  return {
    ok: true,
    messages,
    window: { open: window.open, text: windowExplanation(window, "whatsapp") },
    ad,
    sendLock: lock ? { since: lock.since, note: sendLockWords(lock) } : null,
  };
}

/** The account's lock, from its newest sends, remembered 30 s so every open chat's refresh does not re-read it. */
const sendLocks = new Map<string, { at: number; lock: SendLock | null }>();
const SEND_LOCK_MEMORY_MS = 30_000;

async function accountSendLock(accountId: string, now: number): Promise<SendLock | null> {
  const hit = sendLocks.get(accountId);
  if (hit && now - hit.at < SEND_LOCK_MEMORY_MS) return hit.lock;
  const rows = await readRecentOutbound(accountId, 60);
  const lock = rows ? sendLockFrom(rows, now) : (hit?.lock ?? null);
  sendLocks.set(accountId, { at: now, lock });
  return lock;
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
  attachment?: OutgoingAttachment,
  staffId?: string
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
    staffId: staffId ?? null,
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
 * Permission to upload one file for a reply, on WhatsApp, Instagram or
 * Facebook. Every gate the send itself has is checked FIRST — nobody waits for
 * a 25 MB upload that could never be sent — and the place it goes is chosen
 * here, under this conversation, never by the browser.
 */
export async function prepareUpload(
  threadId: unknown,
  file: { kind: unknown; mime: unknown; size: unknown },
  live: boolean
): Promise<UploadGrant> {
  const wa = await whatsappAccountOf(threadId);
  if (!wa) return prepareMetaUpload(threadId, file, live);
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

/** The same, for Instagram and Facebook: the window as Meta has it right now, and that channel's rules. */
async function prepareMetaUpload(
  threadId: unknown,
  file: { kind: unknown; mime: unknown; size: unknown },
  live: boolean
): Promise<UploadGrant> {
  const ids = decodeThreadId(threadId);
  if (!ids) return { kind: "refused", status: 400, problem: "That conversation link is not valid." };
  const t = await openThreadForSend(threadId, new Date());
  if (!t.ok) return { kind: "refused", status: t.status, problem: t.problem };
  const check = checkOutbound(file.kind, file.mime, file.size, t.account.channel);
  if (!check.ok) return { kind: "refused", status: 400, problem: check.problem };
  if (!t.peer) return { kind: "refused", status: 409, problem: "Could not tell who the customer is in this conversation." };
  if (!t.window.open && !humanAgentWindow(lastCustomerAt(t.messages), new Date())) {
    return { kind: "window_closed", explanation: windowExplanation(t.window, t.account.channel as ChannelKey) };
  }
  if (!live) return { kind: "switched_off" };

  const path = outboundMediaPath(t.account.id, ids.metaConversationId, crypto.randomUUID(), check.ext);
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
      /** The route's own reader, for asking more of the same person (their profile). */
      get: GraphFn;
      /** Which route the thread was read on — a reply goes back on the same one. */
      via: "instagram-login" | "facebook-login";
      messages: InboxMessage[];
      peer: Peer | null;
      window: ReplyWindow;
      /** False when Meta answered words only this time: the screen keeps the files it already had. */
      attachmentsRead: boolean;
      attachmentsNote: string | null;
      /** True when fewer than the full page was asked (Meta was slow): the screen merges, never replaces. */
      partial: boolean;
    }
  | { ok: false; status: number; problem: string };

/**
 * A thread read from Meta, kept 90 s in this server's memory for SENDING (Samer, 2026-10-20: "very slow when
 * sending"): every send and every file used to read the whole conversation from Meta again just to learn who
 * the customer is and whether the 24-hour window is open. The thread the screen just loaded is reused instead;
 * Meta still refuses a send whose window has shut, and that refusal is shown as "window closed".
 */
const sendThreads = new Map<string, { at: number; thread: Extract<OpenThread, { ok: true }> }>();
const SEND_THREAD_TTL_MS = 90_000;

async function openThreadForSend(threadId: unknown, now: Date): Promise<OpenThread> {
  const key = typeof threadId === "string" ? threadId : "";
  const hit = sendThreads.get(key);
  if (hit && Date.now() - hit.at < SEND_THREAD_TTL_MS) return { ...hit.thread, window: replyWindow(lastCustomerAt(hit.thread.messages), now) };
  return openThread(threadId, now);
}

async function openThread(threadId: unknown, now: Date): Promise<OpenThread> {
  const t = await readMetaThread(threadId, now);
  if (t.ok && typeof threadId === "string") {
    sendThreads.set(threadId, { at: Date.now(), thread: t });
    if (sendThreads.size > 500) sendThreads.delete(sendThreads.keys().next().value as string);
  }
  return t;
}

async function readMetaThread(threadId: unknown, now: Date): Promise<OpenThread> {
  const ids = decodeThreadId(threadId);
  if (!ids) return { ok: false, status: 400, problem: "That conversation link is not valid." };

  const all = await listAccounts();
  const account = all.find((a) => a.id === ids.accountId);
  if (!account || !isMetaChannel(account)) {
    return { ok: false, status: 404, problem: "That account is not connected." };
  }

  const route = await readRoute(account, all);
  if (!route.ok) return { ok: false, status: 503, problem: route.problem };

  // What the messages carry first; words only as the last resort (askThread).
  const { r, level, limit, richProblem, rememberedUntil } = await askThread(route, ids.metaConversationId, account.channel, `${account.id}:${route.via}`);
  if (!r.ok) return { ok: false, status: 502, problem: r.problem };

  const threadId_ = `${ids.accountId}~${ids.metaConversationId}`;
  const messages = mapThread(r.json, threadId_, route.selfIds);
  const attachmentsRead = level < WORDS_ONLY;
  return {
    ok: true,
    account,
    token: route.token,
    get: route.get,
    via: route.via,
    messages,
    peer: peerOf(r.json, route.selfIds),
    window: replyWindow(lastCustomerAt(messages), now),
    attachmentsRead,
    attachmentsNote: attachmentsRead ? null : attachmentsNote(account.channel, richProblem, rememberedUntil),
    partial: limit < THREAD_LIMITS[0],
  };
}

/**
 * STAFF-ONLY DIAGNOSIS of one Instagram / Facebook thread (Samer, 2026-10-23:
 * "a message the client sent says photo, video or attachment — open the app to
 * see it"): every ask made, how long each took and what Meta answered, then
 * the SHAPE of each message as Meta returned it — which keys, which attachment
 * kinds and MIME types, whether Meta marked it unsupported — and what the inbox
 * made of it. Never a word of the message, never a link, never a key. Runs its
 * own asks (a scratch memory key), so it neither uses nor changes what the
 * inbox remembers about the account.
 */
export async function diagnoseThread(threadId: unknown): Promise<
  | { ok: true; thread: string; channel: string; via: string; remembered: string; asks: ThreadAskRecord[]; messages: MessageShape[] }
  | { ok: false; status: number; problem: string }
> {
  const ids = decodeThreadId(threadId);
  if (!ids) return { ok: false, status: 400, problem: "That conversation link is not valid." };
  const all = await listAccounts();
  const account = all.find((a) => a.id === ids.accountId);
  if (!account || !isMetaChannel(account)) return { ok: false, status: 404, problem: "That account is not connected." };
  const route = await readRoute(account, all);
  if (!route.ok) return { ok: false, status: 503, problem: route.problem };

  const memoryKey = `${account.id}:${route.via}`;
  const remembered = richFieldsWorks.get(memoryKey);
  const asks: ThreadAskRecord[] = [];
  const scratch = `diagnose:${memoryKey}:${Date.now()}`;
  const { r } = await askThread(route, ids.metaConversationId, account.channel, scratch, (a) => asks.push(a));
  richFieldsWorks.delete(scratch);
  const messages = r.ok ? messageShapes(r.json, `${ids.accountId}~${ids.metaConversationId}`, route.selfIds) : [];
  return {
    ok: true,
    thread: `${ids.accountId}~${ids.metaConversationId.slice(-6)}`,
    channel: account.channel,
    via: route.via,
    remembered:
      remembered && remembered.until > Date.now()
        ? `level ${remembered.level} until ${new Date(remembered.until).toISOString()}${remembered.detail ? ` (${remembered.detail})` : ""}`
        : "nothing",
    asks,
    messages,
  };
}

export type ThreadView =
  | {
      ok: true;
      messages: InboxMessage[];
      /** `humanAgent`: past 24 h, within 7 days — a person may still reply (Instagram / Messenger). */
      window: { open: boolean; text: string; humanAgent?: boolean };
      /** Instagram and Facebook: who the customer is, as Meta shows them. */
      profile?: CustomerProfile | null;
      /** The ad the customer came from, shown above their first message (030). */
      ad?: AdCard | null;
      /** Instagram / Facebook: false when this read came without its files (the screen keeps what it had). */
      attachmentsRead?: boolean;
      attachmentsNote?: string | null;
      /** Instagram / Facebook: fewer messages than the full page were asked — the screen merges, never replaces. */
      partial?: boolean;
      /** WhatsApp: Meta has locked the business account — every send fails until its review (sendLockFrom). */
      sendLock?: { since: string; note: string } | null;
    }
  | { ok: false; status: number; problem: string };

/* ── Who the customer is (Samer, 2026-09-15) ─────────────────────────────── */

/** A person's profile is remembered this long; Meta's picture links last days. */
const PROFILE_MEMORY_MS = 6 * 60 * 60_000;
/** Nothing usable came back: ask again sooner. */
const NO_PROFILE_MEMORY_MS = 30 * 60_000;
const profileMemory = new Map<string, { profile: CustomerProfile | null; until: number }>();
/** Facebook refuses profiles until "Business Asset User Profile Access" is approved — remembered per account. */
const facebookProfilesRefused = new Map<string, number>();
/** Which person a conversation is with — it never changes. */
const peerMemory = new Map<string, string>();

/**
 * Their name, username, picture, followers and follow state, from Meta —
 * never stored (the picture link expires within days). Instagram answers with
 * the permissions MONZA AI already has; Facebook needs Meta's "Business Asset
 * User Profile Access", and until that is approved the refusal is remembered
 * and the screen shows initials (rule 21: a refusal, not an empty profile).
 */
async function readProfile(
  account: StoredAccount,
  get: GraphFn,
  token: string,
  personId: string
): Promise<CustomerProfile | null> {
  const key = `${account.id}:${personId}`;
  const hit = profileMemory.get(key);
  if (hit && hit.until > Date.now()) return hit.profile;

  let profile: CustomerProfile | null = null;
  if (account.channel === "facebook") {
    const refusedUntil = facebookProfilesRefused.get(account.id);
    if (refusedUntil && refusedUntil > Date.now()) return null;
    const r = await get(personId, { fields: PROFILE_FIELDS.facebook }, token, TIMEOUT_MS);
    if (r.ok) {
      profile = mapCustomerProfile(r.json);
    } else {
      facebookProfilesRefused.set(account.id, Date.now() + PROFILE_MEMORY_MS);
      console.warn(`[channels/profile] ${account.id}: Meta refused Facebook profiles — ${r.meta ?? r.problem}`);
    }
  } else {
    const r = await get(personId, { fields: PROFILE_FIELDS.instagram }, token, TIMEOUT_MS);
    if (r.ok) {
      profile = mapCustomerProfile(r.json);
    } else {
      // Some accounts refuse the follow fields; the basics are worth a second ask.
      const basic = await get(personId, { fields: "name,username,profile_pic" }, token, TIMEOUT_MS);
      if (basic.ok) profile = mapCustomerProfile(basic.json);
      else console.warn(`[channels/profile] ${account.id}: Meta refused the Instagram profile — ${basic.meta ?? basic.problem}`);
    }
  }
  profileMemory.set(key, { profile, until: Date.now() + (profile ? PROFILE_MEMORY_MS : NO_PROFILE_MEMORY_MS) });
  return profile;
}

/** Profiles asked for at once, from the conversation list. */
export const PROFILES_PER_REQUEST = 12;

/**
 * Profiles for the conversation rows on screen. Each id must be one of OUR
 * thread ids; the person is read from the conversation ON META, never taken
 * from the browser. WhatsApp threads have no profile (Meta shares none).
 */
export async function readProfilesForStaff(threadIds: readonly unknown[]): Promise<Record<string, CustomerProfile | null>> {
  const out: Record<string, CustomerProfile | null> = {};
  const all = await listAccounts();
  const wanted = threadIds.filter((id): id is string => typeof id === "string").slice(0, PROFILES_PER_REQUEST);
  await Promise.all(
    wanted.map(async (threadId) => {
      const ids = decodeThreadId(threadId);
      const account = ids ? all.find((a) => a.id === ids.accountId) : undefined;
      if (!ids || !account || !isMetaChannel(account)) return;
      try {
        const route = await readRoute(account, all);
        if (!route.ok) {
          out[threadId] = null;
          return;
        }
        let personId = peerMemory.get(threadId);
        if (!personId) {
          const r = await route.get(ids.metaConversationId, { fields: "participants" }, route.token, TIMEOUT_MS);
          const peer = r.ok ? peerOf(r.json, route.selfIds) : null;
          if (!peer) {
            out[threadId] = null;
            return;
          }
          personId = peer.id;
          peerMemory.set(threadId, personId);
        }
        out[threadId] = await readProfile(account, route.get, route.token, personId);
      } catch {
        out[threadId] = null;
      }
    })
  );
  return out;
}

/** What the screen needs for one open thread. The token never leaves here. */
export async function readThreadForStaff(threadId: unknown): Promise<ThreadView> {
  const wa = await whatsappAccountOf(threadId);
  if (wa) return readWhatsAppThread(wa.account, wa.id, new Date());
  const t = await openThread(threadId, new Date());
  if (!t.ok) return t;
  if (t.peer && typeof threadId === "string") peerMemory.set(threadId, t.peer.id);
  const ids = decodeThreadId(threadId);
  const [profile, ad] = await Promise.all([
    t.peer ? readProfile(t.account, t.get, t.token, t.peer.id).catch(() => null) : Promise.resolve(null),
    ids ? adForMetaThread(t.account.id, ids.metaConversationId) : Promise.resolve(null),
  ]);
  return {
    ok: true,
    profile,
    ad,
    messages: t.messages,
    window: humanAgentWindow(lastCustomerAt(t.messages), new Date()) && !t.window.open
      ? { open: true, text: HUMAN_AGENT_TEXT, humanAgent: true }
      : { open: t.window.open, text: windowExplanation(t.window, t.account.channel as ChannelKey) },
    attachmentsRead: t.attachmentsRead,
    attachmentsNote: t.attachmentsNote,
    partial: t.partial,
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
  /** Our own record of recent sends (WhatsApp): the lock shows there before anywhere else. */
  recentOutbound?: (accountId: string) => Promise<OutboundRecord[] | null>;
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
    recentOutbound: readRecentOutbound,
  };
}

/**
 * The WhatsApp account's diagnosis (Samer, 2026-10-23: "when I'm sending a
 * message it is not sending, it tells me WhatsApp Business is locked"): first
 * OUR record — were recent sends accepted and then failed with Meta's lock
 * words, since when, how many — then Meta's Health Status API on the business
 * number (`GET /{phone-number-id}?fields=health_status`: AVAILABLE / LIMITED /
 * BLOCKED per entity, with Meta's error code, description and possible
 * solution). Reads only; nothing here can touch the number or its registration.
 */
async function diagnoseWhatsApp(account: StoredAccount, io: DiagnoseIO): Promise<Diagnosis> {
  const steps: DiagnoseStep[] = [];
  const add = (step: string, ms: number, status: CheckStatus, detail: string) => steps.push({ step, ms, status, detail });

  const t0 = io.now();
  const recent = io.recentOutbound ? await io.recentOutbound(account.id) : undefined;
  if (recent === undefined) add("Our record of recent sends", 0, "skipped", "Not asked: no record reader was given.");
  else if (recent === null) add("Our record of recent sends", io.now() - t0, "unknown", "The database could not be read.");
  else {
    // What the record PROVES: a lock when the newest send failed with Meta's lock words and it is recent;
    // an older lock with nothing sent since proves nothing about now (unknown); otherwise the plain figures.
    const lock = sendLockFrom(recent, io.now());
    const lockFailures = recent.filter((r) => r.status === "failed" && isAccountLockError(r.error));
    const failed = recent.filter((r) => r.status === "failed").length;
    const through = recent.find((r) => r.status === "delivered" || r.status === "read");
    const newest = recent[0];
    const stale = !lock && lockFailures.length > 0 && newest && newest.status === "failed" && isAccountLockError(newest.error);
    add(
      "Our record of recent sends",
      io.now() - t0,
      lock ? "fail" : stale ? "unknown" : "pass",
      lock
        ? `The newest send (${lock.latest}) failed with "${lock.reason}", as did ${lock.failed} since ${lock.since}; nothing of ours went out after it.`
        : stale
          ? `The newest send (${newest.at}) failed with "${newest.error}" and nothing has been sent since — too old to say whether the lock still holds; Meta's status below decides.`
          : `${recent.length} recent sends, ${failed} failed; last delivered or read ${through?.at ?? "never"}${lockFailures.length > 0 ? `; ${lockFailures.length} failed with Meta's lock words before that — the lock is lifted` : ""}.`
    );
  }

  const token = io.tokenFor(account.tokenEnv);
  if (!token) {
    add("Meta's health status for the number", 0, "skipped", `The key ${account.tokenEnv} is not set, so Meta was not asked.`);
    return { ok: true, account: account.id, steps, truncated: false };
  }
  const t1 = io.now();
  const r = await io.graph(account.externalId, { fields: "health_status" }, token, Math.min(TIMEOUT_MS, io.budgetMs));
  if (!r.ok) {
    add("Meta's health status for the number", io.now() - t1, "unknown", `Meta refused the read: ${r.meta ?? r.problem}`);
  } else {
    const h = summariseHealth(r.json);
    add(
      "Meta's health status for the number",
      io.now() - t1,
      h.overall === null ? "unknown" : h.overall === "BLOCKED" ? "fail" : "pass",
      h.overall === null ? "Meta answered without a health_status." : `${h.overall}. ${h.lines.join(" | ")}`
    );
  }
  return { ok: true, account: account.id, steps, truncated: false };
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
  if (account?.channel === "whatsapp") return diagnoseWhatsApp(account, io);
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
 * An approved WhatsApp TEMPLATE to a customer — the only thing WhatsApp delivers after the 24-hour window, and
 * it costs money (Samer, 2026-10-20: "reply even after 24 hours"). A person picks one an admin listed
 * (wa_reply_templates, 031), fills its blanks and presses Send. The recipient is read from OUR conversation; the
 * send switch and the key are checked as for any reply; the words that went are kept in the thread.
 */
export async function sendTemplateOnThread(
  threadId: unknown,
  template: { name: string; language: string; body: string; params: number },
  params: readonly string[],
  live: boolean,
  staffName: string,
  staffId?: string
): Promise<SendOutcome> {
  const wa = await whatsappAccountOf(threadId);
  if (!wa) return { kind: "refused", status: 400, problem: "Templates are for WhatsApp conversations." };
  const r = await readWhatsAppMessages(wa.account.id, wa.id, 1);
  if (!r.ok) return { kind: "refused", status: 502, problem: "Could not read this WhatsApp conversation." };
  if (!r.value || r.value.peerExternalId === "") return { kind: "refused", status: 404, problem: "That conversation was not found." };
  if (!live) return { kind: "switched_off" };
  const token = channelToken(wa.account.tokenEnv);
  if (!token) return { kind: "refused", status: 503, problem: "The WhatsApp sending key has not been added yet, so nothing was sent." };
  const bodyParams = params.slice(0, template.params).map(cleanParam);
  const sent = await sendWhatsAppTemplate({ phoneNumberId: wa.account.externalId, to: r.value.peerExternalId, template: template.name, language: template.language, bodyParams }, token);
  if (!sent.ok) return { kind: "refused", status: 502, problem: `WhatsApp did not send the template: ${sent.problem}` };
  const recorded = await recordWhatsAppSent({
    accountId: wa.account.id,
    brand: wa.account.brand,
    conversationId: wa.id,
    externalMessageId: sent.externalMessageId,
    text: renderTemplate(template.body, bodyParams),
    at: new Date().toISOString(),
    staffName,
    staffId: staffId ?? null,
  });
  if (!recorded) console.error("[channels/template] sent, but our copy could not be written");
  return { kind: "sent" };
}

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
  /** A file already uploaded for this conversation (POST /api/channels/media). */
  attachment?: OutgoingAttachment,
  /** Who pressed Send, for the record of a kept Instagram/Facebook file. */
  staffId?: string
): Promise<SendOutcome> {
  const wa = await whatsappAccountOf(threadId);
  if (wa) return sendOnWhatsApp(wa.account, wa.id, text, live, staffName, attachment, staffId);
  const t = await openThreadForSend(threadId, new Date());
  if (!t.ok) return { kind: "refused", status: t.status, problem: t.problem };
  if (!t.peer) {
    return { kind: "refused", status: 409, problem: "Could not tell who the customer is in this conversation." };
  }
  // Past 24 h but within 7 days: a person's own reply goes with Meta's HUMAN_AGENT tag (Samer, 2026-10-20).
  const humanAgent = !t.window.open && humanAgentWindow(lastCustomerAt(t.messages), new Date());
  if (!t.window.open && !humanAgent) {
    return { kind: "window_closed", explanation: windowExplanation(t.window, t.account.channel as ChannelKey) };
  }
  if (!live) return { kind: "switched_off" };
  const tagged = (problem: string) =>
    humanAgent ? `${problem} (Sent after 24 hours with Meta's Human Agent tag — Meta must have approved that feature for this app; if not, wait for the customer to write again.)` : problem;

  // A thread read through Instagram login is answered through it too: its
  // token and its customer id belong to graph.instagram.com.
  const send =
    t.account.channel !== "instagram"
      ? messengerAdapter.send
      : t.via === "instagram-login"
        ? sendInstagramLogin
        : instagramAdapter.send;
  if (!attachment) {
    const result = await send({ accountId: t.account.id, toExternalId: t.peer.id, text, humanAgent }, t.token);
    if (result.ok) {
      const ids = decodeThreadId(threadId);
      if (ids) await recordStaffTurn({ accountId: t.account.id, peerExternalId: t.peer.id, metaConversationId: ids.metaConversationId, externalMessageId: result.externalMessageId, staffId: staffId ?? null, at: new Date().toISOString() });
      return { kind: "sent" };
    }
    // Codes only in the log — never the words, never the customer.
    console.warn(`[channels/send] ${t.account.id} refused: ${result.kind ?? "unknown"} (${result.codes ?? "no code"}) via ${t.via ?? "facebook-login"}`);
    return { kind: "refused", status: 502, problem: tagged(result.error) };
  }

  // A file: only one uploaded for THIS conversation, checked again against the
  // channel's own rules, handed to Meta by a link that lives ten minutes.
  const ids = decodeThreadId(threadId);
  if (!ids || !isOutboundPathFor(attachment.path, t.account.id, ids.metaConversationId)) {
    return { kind: "refused", status: 400, problem: "That file does not belong to this conversation." };
  }
  const file = await readUploaded(attachment.path);
  if (!file.ok) return { kind: "refused", status: 404, problem: "The file did not finish uploading — attach it again." };
  const check = checkOutbound(attachment.kind, verifiedType(file.mime, file.bytes), file.bytes.length, t.account.channel);
  if (!check.ok) {
    await removeMedia([attachment.path]);
    return { kind: "refused", status: 400, problem: check.problem };
  }
  const link = await signFor(attachment.path, META_FILE_LINK_SECONDS);
  if (!link) {
    await removeMedia([attachment.path]);
    return { kind: "refused", status: 503, problem: "Could not prepare the file for Meta — nothing was sent." };
  }

  const sent = await send(
    {
      accountId: t.account.id,
      toExternalId: t.peer.id,
      text: "",
      attachment: { type: check.kind === "document" ? "file" : check.kind, url: link },
      humanAgent,
    },
    t.token
  );
  if (!sent.ok) {
    await removeMedia([attachment.path]);
    console.warn(`[channels/send] ${t.account.id} refused a file: ${sent.kind ?? "unknown"} (${sent.codes ?? "no code"})`);
    return { kind: "refused", status: 502, problem: tagged(`The file was not sent. ${sent.error}`) };
  }

  // Kept 12 months like WhatsApp (Samer, 2026-09-15; migration 011). It WENT:
  // failing to record the copy must not report a failure.
  const recorded = await recordSentFile({
    accountId: t.account.id,
    brand: t.account.brand,
    conversationRef: ids.metaConversationId,
    externalMessageId: /-unknown-/.test(sent.externalMessageId) ? null : sent.externalMessageId,
    path: attachment.path,
    kind: check.kind,
    mime: check.mime,
    size: file.bytes.length,
    staffId: staffId ?? null,
  });
  if (!recorded) console.error("[channels/send] file sent, but its record could not be written");
  await recordStaffTurn({ accountId: t.account.id, peerExternalId: t.peer.id, metaConversationId: ids.metaConversationId, externalMessageId: sent.externalMessageId, staffId: staffId ?? null, at: new Date().toISOString() });

  // Instagram and Messenger files carry no caption: the words follow as their own message.
  if (text !== "") {
    const words = await send({ accountId: t.account.id, toExternalId: t.peer.id, text, humanAgent }, t.token);
    if (!words.ok) {
      return { kind: "refused", status: 502, problem: `The file was sent, but the words were not: ${words.error}` };
    }
  }
  return { kind: "sent" };
}

/** How long Meta has to fetch a file staff send on Instagram or Facebook. */
const META_FILE_LINK_SECONDS = 10 * 60;

export type SuggestionTarget =
  | { kind: "ok"; target: SendTarget; account: StoredAccount; conversationId: string }
  | Exclude<SendOutcome, { kind: "sent" }>;

/**
 * Where a sales suggestion that a PERSON approved goes (lib/wasales/
 * suggestion-server.ts) — through the same gates as a typed reply, in the same
 * order: the 24-hour window, then the send switch, then the key. The
 * recipient is read from the conversation — ours for WhatsApp, Meta's for
 * Instagram and Facebook — never taken from the browser, and a thread read
 * through Instagram login is answered through it too (rule 49).
 */
export async function suggestionTarget(threadId: unknown, live: boolean): Promise<SuggestionTarget> {
  const wa = await whatsappAccountOf(threadId);
  if (wa) {
    const r = await readWhatsAppMessages(wa.account.id, wa.id, 1);
    if (!r.ok) return { kind: "refused", status: 502, problem: "Could not read this WhatsApp conversation." };
    if (!r.value || r.value.peerExternalId === "") {
      return { kind: "refused", status: 404, problem: "That conversation was not found." };
    }
    const window = replyWindow(r.value.lastInboundAt, new Date());
    if (!window.open) return { kind: "window_closed", explanation: windowExplanation(window, "whatsapp") };
    if (!live) return { kind: "switched_off" };
    const token = channelToken(wa.account.tokenEnv);
    if (!token) {
      return { kind: "refused", status: 503, problem: "The WhatsApp sending key has not been added yet, so nothing was sent." };
    }
    return {
      kind: "ok",
      target: { channel: "whatsapp", phoneNumberId: wa.account.externalId, to: r.value.peerExternalId, token },
      account: wa.account,
      conversationId: wa.id,
    };
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
  const channel = t.account.channel === "instagram" ? "instagram" : "facebook";
  const host = channel === "instagram" && t.via === "instagram-login" ? IG_GRAPH : GRAPH;
  return {
    kind: "ok",
    target: { channel, host, recipientId: t.peer.id, token: t.token },
    account: t.account,
    conversationId: decodeThreadId(threadId)?.metaConversationId ?? "",
  };
}

/**
 * The Meta conversation for one customer of one Instagram or Facebook account.
 * A webhook names the customer (their scoped id), not the conversation, and the
 * sales autoreply pilot needs the thread to read and answer it.
 */
export async function metaThreadFor(accountId: string, peerId: string): Promise<string | null> {
  if (!/^\d{3,40}$/.test(peerId)) return null;
  const all = await listAccounts();
  const account = all.find((a) => a.id === accountId);
  if (!account || !isMetaChannel(account)) return null;
  const route = await readRoute(account, all);
  if (!route.ok) return null;
  const r = await route.get(
    route.listPath,
    { platform: account.channel === "instagram" ? "instagram" : "messenger", user_id: peerId, fields: "id" },
    route.token,
    THREAD_TIMEOUT_MS
  );
  if (!r.ok) return null;
  const data = r.json && typeof r.json === "object" ? (r.json as { data?: unknown }).data : null;
  const first = Array.isArray(data) ? (data[0] as { id?: unknown } | undefined) : undefined;
  if (typeof first?.id !== "string") return null;
  const threadId = encodeThreadId(account.id, first.id);
  return decodeThreadId(threadId) ? threadId : null;
}

/** The customer's id in a thread: ours for WhatsApp, Meta's participants otherwise. */
export async function threadPeerId(threadId: unknown): Promise<string | null> {
  const wa = await whatsappAccountOf(threadId);
  if (wa) {
    const r = await readWhatsAppMessages(wa.account.id, wa.id, 1);
    return r.ok && r.value ? r.value.peerExternalId : null;
  }
  const t = await openThreadForSend(threadId, new Date());
  return t.ok && t.peer ? t.peer.id : null;
}

/* ── Insights: the Instagram and Facebook history, read for LABELS (Samer, 2026-10-12) ──────────── */

/** One thread as the insights reader needs it. The words live in memory only and are dropped by the caller. */
export interface InsightThread {
  metaConversationId: string;
  updatedAt: string | null;
  peer: Peer | null;
  /** Oldest first; Meta details the latest 20 per thread. */
  messages: InboxMessage[];
}

export type InsightThreadsPage =
  | { ok: true; threads: InsightThread[]; next: string | null; calls: number; usage: number | null; via: "instagram-login" | "facebook-login" }
  | { ok: false; code: string; problem: string; calls: number };

/** Lighter and lighter, as the inbox list does. Words only: attachments are never asked for here. */
const INSIGHT_LIST_SHAPES = [
  // Small pages first: Instagram answers 25 threads × 20 messages too slowly (seen live, 2026-10-12).
  { limit: 10, messages: 20 },
  { limit: 5, messages: 20 },
  { limit: 5, messages: 10 },
] as const;

/**
 * One page of an Instagram or Facebook account's conversations, each with its latest messages — for
 * the insights reader (lib/insights/meta-backfill.ts), which keeps labels and never the words. The key
 * stays here (rule 11); the account comes from OUR registry and the cursor is checked, exactly as
 * readMore does. Read-only: nothing is sent, nothing is configured.
 */
export async function readThreadsForInsights(accountId: string, after: string | null, budgetMs: number): Promise<InsightThreadsPage> {
  if (after !== null && !isSafeCursor(after)) return { ok: false, code: "bad_cursor", problem: "The saved place in the history is not valid.", calls: 0 };
  const all = await listAccounts();
  const account = all.find((a) => a.id === accountId);
  if (!account || !isMetaChannel(account)) return { ok: false, code: "not_connected", problem: "That account is not connected.", calls: 0 };
  const route = await readRoute(account, all);
  if (!route.ok) return { ok: false, code: route.state, problem: route.problem, calls: 1 };

  const platform = account.channel === "instagram" ? "instagram" : "messenger";
  const started = Date.now();
  let calls = 0;
  let r: GraphResult = { ok: false, problem: "Nothing was asked.", retryLighter: false };
  for (const shape of INSIGHT_LIST_SHAPES) {
    const remaining = budgetMs - (Date.now() - started);
    if (remaining < 2_000) break;
    calls++;
    r = await route.get(
      route.listPath,
      { platform, fields: `id,updated_time,participants,messages.limit(${shape.messages}){${MESSAGE_FIELDS}}`, limit: String(shape.limit), ...(after ? { after } : {}) },
      route.token,
      Math.min(25_000, remaining)
    );
    if (r.ok || !r.retryLighter) break;
  }
  if (!r.ok) return { ok: false, code: metaErrorCode(r.meta) ?? (r.retryLighter ? "too_slow" : "meta_error"), problem: r.problem, calls };

  const data = r.json && typeof r.json === "object" ? (r.json as { data?: unknown }).data : null;
  const threads: InsightThread[] = [];
  for (const raw of Array.isArray(data) ? data : []) {
    const c = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    const metaId = typeof c?.id === "string" ? c.id : null;
    if (!metaId || !decodeThreadId(encodeThreadId(account.id, metaId))) continue;
    threads.push({
      metaConversationId: metaId,
      updatedAt: graphTime(c?.updated_time),
      peer: peerOf(c, route.selfIds),
      messages: mapThread(c, encodeThreadId(account.id, metaId), route.selfIds),
    });
  }
  return { ok: true, threads, next: nextCursor(r.json), calls, usage: r.usage ?? null, via: route.via };
}
