"use client";

/**
 * THE INBOX — rebuilt from scratch 2026-09-14.
 *
 * Samer: "fully redesign the inbox … very very more filtered and modern …
 * more comfort and ordered, not messy", "every time it is loading 2000 chats
 * on every reload", "filter for time, from/to date", "the username show and
 * the notification", and MHERO's Instagram "separated from VOYAH".
 *
 * ── Loading: once, then only what is new ─────────────────────────────────
 * Conversations already read are saved in this browser (lib/inbox/cache.ts)
 * and on screen the instant the page opens. Meta is then asked for page one of
 * every account, and further pages ONLY until a conversation we already hold
 * comes back unchanged (reachedKnown) — a reload costs one page per account,
 * not two thousand conversations. History is paged in once, in the
 * background; its cursor is saved after every page, so a reload resumes it.
 *
 * ── Brands are separate ──────────────────────────────────────────────────
 * VOYAH, MHERO and MONZA SAL are tabs. Which brand a conversation belongs to
 * is the brand of the ACCOUNT it arrived at (rule 1), never its text.
 *
 * ── Unread and alerts ────────────────────────────────────────────────────
 * Meta's list says nothing about what we have read, so "unread" is kept per
 * person: the customer wrote after this person last opened it. The first
 * visit sets a baseline, so history does not arrive as 2,000 unread. A new
 * message found while the inbox is open shows a toast, and — if the person
 * allowed it — a browser notification while the tab is in the background.
 *
 * Sending, the 24-hour window and the demo mode behave as before.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import DraftDock from "./DraftDock";
import MediaComposer from "./MediaComposer";
import { Attachments, LinkEmbeds, Lightbox, Ticks } from "./MediaBubble";
import { carryUrls, isMetaCdn, previewText, waWebChatLink, withoutLinks } from "@/lib/inbox/media";
import type { Conversation, CustomerProfile, InboxMessage } from "@/lib/inbox/types";
import {
  CHANNEL_LABEL,
  VEHICLE_STATUS_LABEL,
  type ChannelKey,
  type Customer,
  type Installment,
  type Vehicle,
} from "@/lib/domain/types";
import { longDate, usd, waLink } from "@/lib/format";
import { emptyMeta, openInboxCache, type AccountMeta, type InboxCache } from "@/lib/inbox/cache";
import {
  DATE_PRESETS,
  EMPTY_VIEW,
  SHOW_FILTERS,
  SHOW_LABEL,
  accountIdOf,
  arrivals,
  brandLabel,
  brandOf,
  count,
  filterView,
  groupByDay,
  initialsOf,
  isFiltered,
  isUnread,
  localClock,
  localDay,
  mergeConversations,
  orderBrands,
  presetRange,
  reachedKnown,
  type DatePreset,
  type InboxAccount,
  type ShowFilter,
  type ViewFilter,
} from "@/lib/inbox/sync";
import "./inbox.css";

interface Props {
  /** The CRM source is the demo one. */
  demo: boolean;
  /** At least one channel account is registered: conversations come from Meta. */
  live: boolean;
  accounts: InboxAccount[];
  /** The signed-in person's id — their saved inbox lives under it. */
  viewerKey: string;
  sourceLabel: string;
  /** Demo threads only; live ones come from Meta. */
  conversations: Conversation[];
  messages: InboxMessage[];
  customers: Customer[];
  openInstallments: Installment[];
  vehicles: Vehicle[];
}

type PageResult =
  | { ok: true; conversations: Conversation[]; next: string | null; lite: boolean; note: string | null }
  | { ok: false; message: string };

type ThreadResponse =
  | {
      ok: true;
      messages: InboxMessage[];
      window: { open: boolean; text: string };
      /** Instagram and Facebook: who the customer is, as Meta shows them. */
      profile?: CustomerProfile | null;
    }
  | { ok: false; message?: string };

interface ThreadState {
  messages: InboxMessage[];
  loading: boolean;
  problem: string | null;
  windowOpen: boolean;
  windowText: string;
}

const EMPTY_THREAD: ThreadState = {
  messages: [],
  loading: true,
  problem: null,
  windowOpen: false,
  windowText: "",
};

type RunState = "waiting" | "checking" | "ok" | "history" | "paused" | "error";
interface Run {
  state: RunState;
  note: string | null;
}

type AlertsState = "unsupported" | "default" | "granted" | "denied";

/** How often the newest conversations are checked while the inbox is open. */
const CHECK_EVERY_MS = 60_000;
const THREAD_REFRESH_MS = 15_000;
/** Gentle on Meta: a short pause between pages. */
const PAGE_PAUSE_MS = 300;
/** A reload after a long absence still stops somewhere. */
const MAX_CHECK_PAGES = 40;
/** A ceiling on history, so a cursor that never ends cannot loop forever. */
const MAX_HISTORY_PAGES = 400;
/** Rows rendered at a time; more appear as the list scrolls. */
const RENDER_STEP = 120;
/** Read by the sidebar badge. */
const UNREAD_KEY = "monza-ai:inbox-unread";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(accountId: string, after: string, lite: boolean): Promise<PageResult> {
  const qs = new URLSearchParams({ account: accountId, after, lite: lite ? "1" : "0" });
  try {
    const res = await fetch(`/api/channels/more?${qs.toString()}`, { cache: "no-store" });
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      conversations?: Conversation[];
      next?: string | null;
      lite?: boolean;
      note?: string | null;
      message?: string;
    } | null;
    if (res.ok && json?.ok && Array.isArray(json.conversations)) {
      return {
        ok: true,
        conversations: json.conversations,
        next: json.next ?? null,
        lite: json.lite === true,
        note: json.note ?? null,
      };
    }
    return {
      ok: false,
      message:
        (typeof json?.message === "string" && json.message) ||
        (res.status === 401 ? "Please sign in again." : "Meta did not send this account's conversations."),
    };
  } catch {
    return { ok: false, message: "Could not reach Monza AI." };
  }
}

function hasRowsFor(map: ReadonlyMap<string, Conversation>, accountId: string): boolean {
  for (const c of map.values()) {
    if ((c.accountId ?? accountIdOf(c.id)) === accountId) return true;
  }
  return false;
}

/* ── Icons (line, currentColor) ──────────────────────────────────────────── */

function Icon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}

const I = {
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.35-4.35",
  bell: "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0",
  bellOff:
    "M13.73 21a2 2 0 0 1-3.46 0 M18.63 13A17.9 17.9 0 0 1 18 8 M6.26 6.26A5.9 5.9 0 0 0 6 8c0 7-3 9-3 9h14 M18 8a6 6 0 0 0-9.33-5 M1 1l22 22",
  check: "M20 6L9 17l-5-5",
  back: "M15 18l-6-6 6-6",
  send: "M22 2L11 13 M22 2l-7 20-4-9-9-4z",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 16v-4 M12 8h.01",
  calendar: "M3 5h18v16H3z M16 3v4 M8 3v4 M3 11h18",
  x: "M18 6L6 18 M6 6l12 12",
  chat: "M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 1 1 21 11.5z",
  copy: "M9 9h11v11H9z M5 15H4V4h11v1",
  phone:
    "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z",
};

/** The channel's mark, drawn small in the corner of an avatar. */
function ChannelMark({ channel }: { channel: string }) {
  const label = CHANNEL_LABEL[channel as ChannelKey] ?? channel;
  return (
    <span className={`ibx-chan ibx-chan-${channel}`} title={label} aria-label={label}>
      {channel === "instagram" ? (
        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
        </svg>
      ) : channel === "facebook" ? (
        <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true">
          <path d="M14 8h3V4h-3c-2.8 0-4.5 1.8-4.5 4.6V11H7v4h2.5v7h4v-7h3l.5-4h-3.5V9c0-.6.4-1 1-1z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true">
          <path d="M20 11.5a8 8 0 0 1-11.8 7L4 20l1.5-4A8 8 0 1 1 20 11.5z" />
        </svg>
      )}
    </span>
  );
}

function Avatar({
  name,
  brand,
  channel,
  large = false,
  picture,
}: {
  name: string;
  brand: string | null;
  channel: string;
  large?: boolean;
  /** Their Instagram/Facebook picture — drawn only from Meta's own hosts. */
  picture?: string | null;
}) {
  const [broken, setBroken] = useState(false);
  const show = !!picture && isMetaCdn(picture) && !broken;
  return (
    <span className={`ibx-av${large ? " ibx-av-lg" : ""}`} data-brand={brand ?? "none"} aria-hidden="true">
      <span className="ibx-av-txt">{initialsOf(name)}</span>
      {show && (
        // eslint-disable-next-line @next/next/no-img-element -- Meta's own short-lived link
        <img className="ibx-av-img" src={picture ?? undefined} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      )}
      <ChannelMark channel={channel} />
    </span>
  );
}

/**
 * Who the customer is (Samer, 2026-09-15: "their profile picture, their name
 * and everything I can see"). Instagram: picture, name, @username, followers,
 * follows. WhatsApp: the name WhatsApp shares and the number — Meta gives
 * businesses no WhatsApp picture. Facebook: the name, and the picture once
 * Meta approves profile access.
 */
function ProfileCard({ conv, profile }: { conv: Conversation; profile: CustomerProfile | null | undefined }) {
  const [copied, setCopied] = useState(false);
  if (conv.channel === "whatsapp") {
    const chat = waWebChatLink(conv.peerPhone);
    return (
      <div className="ibx-card">
        <p className="ibx-card-title">WhatsApp profile</p>
        <dl className="ibx-facts">
          <dt>Name</dt>
          <dd>{conv.customerName}</dd>
          <dt>Number</dt>
          <dd>
            {conv.peerPhone || "—"}
            {conv.peerPhone && (
              <button
                type="button"
                className="ibx-mini"
                onClick={() => {
                  void navigator.clipboard?.writeText(conv.peerPhone ?? "");
                  setCopied(true);
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            )}
          </dd>
        </dl>
        {chat && (
          <a className="ibx-link" href={chat} target="_blank" rel="noreferrer">
            Open the chat in WhatsApp Web
          </a>
        )}
        <p className="ibx-card-text">WhatsApp does not share customers&apos; profile pictures with businesses.</p>
      </div>
    );
  }

  const picture = profile?.pictureUrl && isMetaCdn(profile.pictureUrl) ? profile.pictureUrl : null;
  const name = profile?.name ?? conv.customerName;
  const handle = profile?.username ?? (conv.customerName.startsWith("@") ? conv.customerName.slice(1) : null);
  return (
    <div className="ibx-card">
      <p className="ibx-card-title">{conv.channel === "instagram" ? "Instagram profile" : "Facebook profile"}</p>
      <div className="ibx-profile-head">
        {picture ? (
          // eslint-disable-next-line @next/next/no-img-element -- Meta's own short-lived link
          <img className="ibx-profile-pic" src={picture} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span className="ibx-profile-pic">{initialsOf(name)}</span>
        )}
        <div>
          <p className="ibx-profile-name">
            {name}
            {profile?.verified ? " ✔" : ""}
          </p>
          {handle && <p className="ibx-profile-user">@{handle}</p>}
        </div>
      </div>
      {profile && (profile.followers !== null || profile.followsYou !== null || profile.youFollow !== null) && (
        <dl className="ibx-facts">
          {profile.followers !== null && (
            <>
              <dt>Followers</dt>
              <dd>{count(profile.followers)}</dd>
            </>
          )}
          {profile.followsYou !== null && (
            <>
              <dt>Follows you</dt>
              <dd>{profile.followsYou ? "Yes" : "No"}</dd>
            </>
          )}
          {profile.youFollow !== null && (
            <>
              <dt>You follow them</dt>
              <dd>{profile.youFollow ? "Yes" : "No"}</dd>
            </>
          )}
        </dl>
      )}
      {conv.channel === "instagram" && handle && /^[A-Za-z0-9._]{1,30}$/.test(handle) && (
        <a className="ibx-link" href={`https://www.instagram.com/${handle}/`} target="_blank" rel="noreferrer">
          Open their profile on Instagram
        </a>
      )}
      {profile === undefined && <p className="ibx-card-text">Loading their profile…</p>}
      {conv.channel === "facebook" && !picture && profile !== undefined && (
        <p className="ibx-card-text">Facebook profile pictures appear once Meta approves profile access for this app.</p>
      )}
    </div>
  );
}

/* ── The screen ──────────────────────────────────────────────────────────── */

export default function InboxClient(props: Props) {
  const { demo, live, accounts, viewerKey, sourceLabel, customers, openInstallments, vehicles } = props;

  // Everything that reads the clock or the time zone renders after mount, so
  // the server's HTML and the browser's first render always agree.
  const [mounted, setMounted] = useState(false);

  const [convMap, setConvMap] = useState<Map<string, Conversation>>(
    () => new Map(props.conversations.map((c) => [c.id, c]))
  );
  const convRef = useRef(convMap);
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;

  const [ready, setReady] = useState(!live);
  const [baselineAt, setBaselineAt] = useState("");
  const baselineRef = useRef("");
  const [seen, setSeen] = useState<Record<string, string>>({});
  const [metas, setMetas] = useState<Record<string, AccountMeta>>({});
  const metasRef = useRef(metas);
  const [runs, setRuns] = useState<Record<string, Run>>(() =>
    Object.fromEntries(accounts.map((a) => [a.id, { state: "waiting", note: null }]))
  );
  const [checking, setChecking] = useState(false);
  const [historyRunning, setHistoryRunning] = useState(false);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [cacheOk, setCacheOk] = useState(true);
  const cacheRef = useRef<InboxCache | null>(null);
  const checkingRef = useRef(false);
  const historyRef = useRef(false);
  const stopHistory = useRef(false);
  const firstCheckDone = useRef(false);

  const [view, setView] = useState<ViewFilter>(EMPTY_VIEW);
  const [datesOpen, setDatesOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [renderCount, setRenderCount] = useState(RENDER_STEP);
  const sentinelRef = useRef<HTMLLIElement>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [thread, setThread] = useState<ThreadState>(EMPTY_THREAD);
  const reloadThread = useRef<(() => void) | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef<string | null>(null);

  const [composerText, setComposerText] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [sending, setSending] = useState(false);
  const [sendNote, setSendNote] = useState<string | null>(null);
  /** A file dropped or pasted into a WhatsApp conversation, for the attach sheet. */
  const [dropped, setDropped] = useState<File | null>(null);
  /** The thread's photos, open full screen. */
  const [viewer, setViewer] = useState<{ images: string[]; index: number } | null>(null);
  /**
   * Instagram and Facebook profiles by thread id — in page memory only, never
   * in the browser's saved copy (Meta's picture links expire within days).
   * `null` = asked, nothing usable; absent = not asked yet.
   */
  const [profiles, setProfiles] = useState<Record<string, CustomerProfile | null>>({});
  const profilesAsked = useRef(new Set<string>());

  const [alerts, setAlerts] = useState<AlertsState>("unsupported");
  const alertsRef = useRef<AlertsState>("unsupported");
  alertsRef.current = alerts;
  const [toast, setToast] = useState<Conversation | null>(null);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== "undefined" && "Notification" in window) {
      const p = Notification.permission;
      setAlerts(p === "granted" ? "granted" : p === "denied" ? "denied" : "default");
    }
  }, []);

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  /* ── Saving and merging ─────────────────────────────────────────────── */

  const setRun = useCallback((id: string, state: RunState, note: string | null) => {
    setRuns((prev) => ({ ...prev, [id]: { state, note } }));
  }, []);

  const saveMeta = useCallback((id: string, patch: Partial<AccountMeta>): AccountMeta => {
    const next: AccountMeta = { ...(metasRef.current[id] ?? emptyMeta(id)), ...patch, id };
    metasRef.current = { ...metasRef.current, [id]: next };
    setMetas(metasRef.current);
    void cacheRef.current?.putMeta(next);
    return next;
  }, []);

  const announce = useCallback((news: Conversation[]) => {
    const first = news[0];
    if (!first) return;
    setToast(first);
    if (alertsRef.current !== "granted" || document.visibilityState === "visible") return;
    for (const c of news.slice(0, 3)) {
      try {
        const brand = brandLabel(brandOf(c, accountsRef.current));
        const n = new Notification(`${c.customerName} · ${brand}`, {
          body: c.lastMessage.text.slice(0, 140),
          tag: c.id,
        });
        n.onclick = () => {
          window.focus();
          setOpenId(c.id);
          n.close();
        };
      } catch {
        // Some browsers refuse notifications outside a service worker; the toast still shows.
      }
    }
  }, []);

  const commit = useCallback(
    (fresh: readonly Conversation[], notify: boolean) => {
      if (fresh.length === 0) return;
      const before = convRef.current;
      const { merged, changed } = mergeConversations(before, fresh);
      if (changed.length === 0) return;
      if (notify) {
        const news = arrivals(before, changed, baselineRef.current);
        if (news.length > 0) announce(news);
      }
      convRef.current = merged;
      setConvMap(merged);
      void cacheRef.current?.putConversations(changed);
    },
    [announce]
  );

  const markSeen = useCallback((entries: [string, string][]) => {
    if (entries.length === 0) return;
    setSeen((prev) => {
      let next: Record<string, string> | null = null;
      for (const [id, at] of entries) {
        if ((prev[id] ?? "") >= at) continue;
        next ??= { ...prev };
        next[id] = at;
      }
      return next ?? prev;
    });
    void cacheRef.current?.setSeen(entries);
  }, []);

  /* ── Checking for new conversations ─────────────────────────────────── */

  /**
   * Page one of every account, and more pages only until one we already hold
   * comes back unchanged. An account seen for the first time takes one page;
   * the rest of its past is the history run's job.
   */
  const checkNewest = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    try {
      await Promise.all(
        accountsRef.current.map(async (a) => {
          const firstTime = !hasRowsFor(convRef.current, a.id);
          const lite = metasRef.current[a.id]?.lite ?? false;
          setRun(a.id, "checking", null);
          let after = "";
          let note: string | null = null;
          for (let pages = 1; pages <= MAX_CHECK_PAGES; pages++) {
            const page = await fetchPage(a.id, after, lite);
            if (!page.ok) {
              setRun(a.id, "error", page.message);
              return;
            }
            note = page.note;
            const known = reachedKnown(convRef.current, page.conversations);
            commit(page.conversations, firstCheckDone.current);
            const stamp = new Date().toISOString();
            if (firstTime) {
              saveMeta(a.id, {
                backfillCursor: page.next,
                complete: page.next === null,
                lite: page.lite,
                lastSyncAt: stamp,
              });
              break;
            }
            if (known || page.next === null || pages === MAX_CHECK_PAGES) {
              saveMeta(a.id, { lite: page.lite, lastSyncAt: stamp });
              break;
            }
            after = page.next;
            await pause(PAGE_PAUSE_MS);
          }
          setRun(a.id, "ok", note);
        })
      );
    } finally {
      checkingRef.current = false;
      firstCheckDone.current = true;
      setChecking(false);
      setLastChecked(new Date().toISOString());
    }
  }, [commit, saveMeta, setRun]);

  /**
   * The past, once. Each account continues from the cursor saved after its
   * last page; when Meta says there is nothing older, it never runs again.
   */
  const runHistory = useCallback(async () => {
    if (historyRef.current) return;
    historyRef.current = true;
    stopHistory.current = false;
    setHistoryRunning(true);
    try {
      await Promise.all(
        accountsRef.current.map(async (a) => {
          let meta = metasRef.current[a.id];
          if (!meta || meta.complete) return;
          let after = meta.backfillCursor ?? "";
          setRun(a.id, "history", null);
          for (let i = 0; i < MAX_HISTORY_PAGES; i++) {
            if (stopHistory.current) {
              setRun(a.id, "paused", "Saving older conversations is paused.");
              return;
            }
            const page = await fetchPage(a.id, after, meta.lite);
            if (!page.ok) {
              setRun(a.id, "paused", `Older conversations paused — ${page.message}`);
              return;
            }
            commit(page.conversations, false);
            meta = saveMeta(a.id, {
              backfillCursor: page.next,
              complete: page.next === null,
              lite: page.lite,
            });
            if (page.next === null) break;
            after = page.next;
            await pause(PAGE_PAUSE_MS);
          }
          setRun(a.id, "ok", null);
        })
      );
    } finally {
      historyRef.current = false;
      setHistoryRunning(false);
    }
  }, [commit, saveMeta, setRun]);

  /** A paused history whose saved cursor Meta no longer accepts starts over from the top. */
  const restartHistory = useCallback(() => {
    for (const a of accountsRef.current) {
      const m = metasRef.current[a.id];
      if (m && !m.complete) saveMeta(a.id, { backfillCursor: null });
    }
    void runHistory();
  }, [runHistory, saveMeta]);

  // Open the saved copy, show it, then check Meta for anything newer.
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    void (async () => {
      const cache = await openInboxCache(viewerKey);
      if (cancelled) return;
      cacheRef.current = cache;
      setCacheOk(cache !== null);
      const snap = cache ? await cache.load() : null;
      if (cancelled) return;

      // Only accounts still registered: a removed account's saved rows stay hidden.
      const known = new Set(accountsRef.current.map((a) => a.id));
      const rows = (snap?.conversations ?? []).filter((c) =>
        known.has(c.accountId ?? accountIdOf(c.id) ?? "")
      );
      const map = new Map(rows.map((c) => [c.id, c]));
      convRef.current = map;
      setConvMap(map);
      metasRef.current = snap?.meta ?? {};
      setMetas(metasRef.current);
      setSeen(snap?.seen ?? {});
      const base = snap?.baselineAt ?? new Date().toISOString();
      if (!snap?.baselineAt) void cache?.setBaseline(base);
      baselineRef.current = base;
      setBaselineAt(base);
      setReady(true);

      await checkNewest();
      if (!cancelled) void runHistory();
    })();
    return () => {
      cancelled = true;
      stopHistory.current = true;
    };
    // The account list and the person do not change while the page is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, viewerKey]);

  // Keep checking while the inbox is open, and the moment it comes back into view.
  useEffect(() => {
    if (!live || !ready) return;
    const t = setInterval(() => void checkNewest(), CHECK_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void checkNewest();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [live, ready, checkNewest]);

  /* ── What is on screen ──────────────────────────────────────────────── */

  const all = useMemo(() => [...convMap.values()], [convMap]);
  const today = mounted ? localDay(new Date().toISOString()) : "";

  // Demo threads carry their own unread count; opening one still clears it,
  // for this visit (nothing is saved in demo mode).
  const unreadOf = useCallback(
    (c: Conversation) =>
      live
        ? isUnread(c, seen[c.id], baselineAt)
        : c.unreadCount > 0 && (seen[c.id] ?? "") < c.lastMessage.at,
    [live, seen, baselineAt]
  );

  const brands = useMemo(() => orderBrands(accounts.map((a) => a.brand)), [accounts]);

  const stats = useMemo(() => {
    const byBrand = new Map<string, { total: number; unread: number }>();
    const byAccount = new Map<string, number>();
    let unread = 0;
    for (const c of all) {
      const b = brandOf(c, accounts) ?? "";
      const s = byBrand.get(b) ?? { total: 0, unread: 0 };
      s.total += 1;
      const u = unreadOf(c);
      if (u) {
        s.unread += 1;
        unread += 1;
      }
      byBrand.set(b, s);
      const acct = c.accountId ?? accountIdOf(c.id) ?? "";
      byAccount.set(acct, (byAccount.get(acct) ?? 0) + 1);
    }
    return { byBrand, byAccount, unread };
  }, [all, accounts, unreadOf]);

  const channels = useMemo(() => {
    const present = new Set(all.map((c) => c.channel as string));
    for (const a of accounts) present.add(a.channel);
    return (["instagram", "facebook", "whatsapp"] as const).filter((ch) => present.has(ch));
  }, [all, accounts]);

  const visible = useMemo(
    () =>
      filterView(all, view, {
        accounts,
        seen,
        baselineAt: live ? baselineAt : "",
        dayOf: localDay,
      }),
    [all, view, accounts, seen, baselineAt, live]
  );

  useEffect(() => setRenderCount(RENDER_STEP), [view]);

  const shown = useMemo(() => visible.slice(0, renderCount), [visible, renderCount]);
  const groups = useMemo(
    () => (mounted ? groupByDay(shown, (c) => c.lastMessage.at, localDay, today) : []),
    [shown, mounted, today]
  );

  // More rows as the list scrolls — two thousand buttons at once is what made
  // the old list heavy.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setRenderCount((n) => n + RENDER_STEP);
      },
      { rootMargin: "800px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown.length, visible.length]);

  // Unread in the tab title and on the sidebar.
  useEffect(() => {
    if (!mounted || !ready) return;
    document.title = stats.unread > 0 ? `(${stats.unread}) Inbox — Monza AI` : "Inbox — Monza AI";
    if (!live) return;
    try {
      localStorage.setItem(UNREAD_KEY, String(stats.unread));
    } catch {
      // Storage refused: the badge simply does not update.
    }
    window.dispatchEvent(new CustomEvent("monza-inbox-unread", { detail: stats.unread }));
  }, [stats.unread, mounted, ready, live]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 9_000);
    return () => clearTimeout(t);
  }, [toast]);

  /* ── The open conversation ──────────────────────────────────────────── */

  const open = openId ? convMap.get(openId) ?? null : null;
  const openBrand = open ? brandOf(open, accounts) : null;
  const openAccount = open ? accountById.get(open.accountId ?? accountIdOf(open.id) ?? "") ?? null : null;

  const openConversation = useCallback(
    (c: Conversation) => {
      setOpenId(c.id);
      markSeen([[c.id, c.lastMessage.at]]);
    },
    [markSeen]
  );

  useEffect(() => {
    if (!live || !openId) return;
    const id = openId;
    let alive = true;
    setThread(EMPTY_THREAD);
    setSendNote(null);

    // The saved copy of this thread first, then Meta.
    void cacheRef.current?.getThread(id).then((saved) => {
      if (alive && saved && saved.length > 0) {
        setThread((t) => (t.messages.length > 0 ? t : { ...t, messages: saved }));
      }
    });

    const ctrl = new AbortController();
    const load = async () => {
      try {
        const res = await fetch(`/api/channels/thread?id=${encodeURIComponent(id)}`, {
          cache: "no-store",
          signal: ctrl.signal,
        });
        const json = (await res.json().catch(() => null)) as ThreadResponse | null;
        if (!alive) return;
        if (res.ok && json && json.ok) {
          // A photo's link is kept while fresh, so the 15-second refresh does not reload it.
          setThread((t) => ({
            messages: carryUrls(t.messages, json.messages, Date.now()),
            loading: false,
            problem: null,
            windowOpen: json.window.open,
            windowText: json.window.text,
          }));
          // Links expire; the saved copy keeps everything else.
          void cacheRef.current?.putThread(id, withoutLinks(json.messages));
          if (json.profile !== undefined) {
            profilesAsked.current.add(id);
            setProfiles((p) => ({ ...p, [id]: json.profile ?? null }));
          }
          // The thread is newer news than the list row: bring the row up to date.
          const last = json.messages[json.messages.length - 1];
          const row = convRef.current.get(id);
          if (last && row && last.at >= row.lastMessage.at) {
            commit(
              [
                {
                  ...row,
                  status: last.direction === "out" ? "waiting_reply" : "open",
                  lastMessage: {
                    text: previewText(last),
                    at: last.at,
                    direction: last.direction,
                    author: last.author,
                  },
                },
              ],
              false
            );
            markSeen([[id, last.at]]);
          }
        } else {
          setThread((t) => ({
            ...t,
            loading: false,
            problem: (json && !json.ok && json.message) || "Could not load this conversation from Meta.",
          }));
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (alive) {
          setThread((t) => ({
            ...t,
            loading: false,
            problem: "Could not reach Monza AI. Check the connection.",
          }));
        }
      }
    };
    reloadThread.current = () => void load();
    void load();
    const t = setInterval(() => void load(), THREAD_REFRESH_MS);
    return () => {
      alive = false;
      ctrl.abort();
      clearInterval(t);
      reloadThread.current = null;
    };
  }, [live, openId, commit, markSeen]);

  const messages = useMemo(() => {
    if (!open) return [];
    return live ? thread.messages : props.messages.filter((m) => m.conversationId === open.id);
  }, [live, thread.messages, props.messages, open]);

  const messageGroups = useMemo(
    () => (mounted ? groupByDay(messages, (m) => m.at, localDay, today) : []),
    [messages, mounted, today]
  );

  /** Every photo in the thread, in order, for the full-screen viewer's arrows. */
  const threadImages = useMemo(
    () =>
      messages.flatMap((m) =>
        (m.attachments ?? [])
          .filter(
            (a) =>
              (a.kind === "image" || a.kind === "sticker" || (a.kind === "share" && isMetaCdn(a.url))) &&
              a.state === "ready" &&
              a.url
          )
          .map((a) => a.url as string)
      ),
    [messages]
  );

  const openImage = useCallback(
    (url: string) => {
      const i = threadImages.indexOf(url);
      setViewer({ images: threadImages, index: i >= 0 ? i : 0 });
    },
    [threadImages]
  );

  const takeDropped = useCallback(() => setDropped(null), []);

  const mediaSent = useCallback(() => {
    setSendNote("Sent.");
    scrolledFor.current = null; // show what just went out
    reloadThread.current?.();
  }, []);

  // A thread opens at its newest message, once per opening — the refresh must
  // not yank somebody reading older ones.
  useEffect(() => {
    if (!openId) {
      scrolledFor.current = null;
      return;
    }
    if (messages.length === 0 || messages[messages.length - 1].conversationId !== openId) return;
    if (scrolledFor.current === openId) return;
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    scrolledFor.current = openId;
  }, [openId, messages]);

  // One customer's half-written reply never travels to another's thread.
  useEffect(() => {
    setComposerText("");
    setDropped(null);
    setViewer(null);
    if (composerRef.current) composerRef.current.style.height = "";
  }, [openId]);

  /** Files and voice notes: any live thread, within its channel's own rules. */
  const canAttach = !!open && live;
  const openProfile = open ? profiles[open.id] : undefined;

  // Pictures for the Instagram and Facebook rows on screen, asked for as they
  // scroll into view, a dozen at a time, each person once per visit.
  useEffect(() => {
    if (!live || typeof IntersectionObserver === "undefined") return;
    const queue = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let alive = true;
    const flush = async () => {
      timer = null;
      const ids = [...queue].slice(0, 12);
      ids.forEach((id) => queue.delete(id));
      if (ids.length === 0) return;
      try {
        const res = await fetch(`/api/channels/profiles?ids=${ids.map(encodeURIComponent).join(",")}`, { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as { profiles?: Record<string, CustomerProfile | null> } | null;
        if (alive && res.ok && json?.profiles) setProfiles((p) => ({ ...p, ...json.profiles }));
      } catch {
        // A picture is a nicety; initials stay.
      }
      if (alive && queue.size > 0) timer = setTimeout(() => void flush(), 1_200);
    };
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const id = (e.target as HTMLElement).dataset.profileId;
        if (id && !profilesAsked.current.has(id)) {
          profilesAsked.current.add(id);
          queue.add(id);
        }
      }
      if (queue.size > 0 && !timer) timer = setTimeout(() => void flush(), 400);
    });
    document.querySelectorAll<HTMLElement>("[data-profile-id]").forEach((el) => io.observe(el));
    return () => {
      alive = false;
      io.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [live, shown]);

  const anchorMessageId = useMemo(() => {
    const last = messages[messages.length - 1];
    return last && last.direction === "in" ? last.id : null;
  }, [messages]);

  const customer = useMemo(
    () => (open && open.customerId ? customers.find((c) => c.id === open.customerId) ?? null : null),
    [customers, open]
  );
  const customerInstallments = useMemo(
    () => (open && open.customerId ? openInstallments.filter((i) => i.customerId === open.customerId) : []),
    [openInstallments, open]
  );
  const customerVehicles = useMemo(
    () => (open && open.customerId ? vehicles.filter((v) => v.customerId === open.customerId) : []),
    [vehicles, open]
  );

  async function sendReply() {
    if (!open || sending) return;
    const text = composerText.trim();
    if (text === "") return;
    setSending(true);
    setSendNote(null);
    try {
      const res = await fetch("/api/channels/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: open.id, text }),
      });
      const json = (await res.json().catch(() => null)) as { delivered?: boolean; message?: string } | null;
      if (res.ok && json?.delivered) {
        setComposerText("");
        if (composerRef.current) composerRef.current.style.height = "";
        setSendNote("Sent.");
        scrolledFor.current = null; // show the reply that just went out
        reloadThread.current?.();
      } else {
        // Not sent: the text stays in the box so nothing is lost.
        setSendNote(json?.message ?? "It was not sent.");
      }
    } catch {
      setSendNote("Could not reach Monza AI — nothing was sent.");
    } finally {
      setSending(false);
    }
  }

  /* ── Actions ────────────────────────────────────────────────────────── */

  function markAllRead() {
    markSeen(all.filter((c) => unreadOf(c)).map((c) => [c.id, c.lastMessage.at]));
  }

  async function enableAlerts() {
    if (!("Notification" in window)) return;
    const p = await Notification.requestPermission();
    setAlerts(p === "granted" ? "granted" : p === "denied" ? "denied" : "default");
  }

  async function clearSaved() {
    if (!window.confirm("Remove the conversations saved on this computer? They will load again from Meta.")) {
      return;
    }
    stopHistory.current = true;
    await cacheRef.current?.clear();
    try {
      localStorage.removeItem(UNREAD_KEY);
    } catch {
      // nothing to remove
    }
    window.location.reload();
  }

  function setDates(from: string, to: string) {
    setView((v) => ({ ...v, from, to }));
  }

  /* ── Status line ────────────────────────────────────────────────────── */

  const troubled = accounts.filter((a) => runs[a.id]?.state === "error");
  const pausedHistory = accounts.filter((a) => runs[a.id]?.state === "paused");
  const historyLeft = accounts.some((a) => metas[a.id] && !metas[a.id].complete);

  const statusState = !live
    ? "demo"
    : !ready
      ? "busy"
      : troubled.length > 0
        ? "warn"
        : checking || historyRunning
          ? "busy"
          : "ok";

  const statusText = !live
    ? "Example conversations"
    : !ready
      ? "Opening saved conversations…"
      : checking
        ? "Checking for new messages…"
        : historyRunning
          ? `Saving older conversations · ${count(all.length)} saved`
          : troubled.length > 0
            ? `${troubled.length} account${troubled.length === 1 ? "" : "s"} need attention`
            : `Up to date · ${count(all.length)} saved${lastChecked ? ` · ${localClock(lastChecked)}` : ""}`;

  const dateActive = view.from !== "" || view.to !== "";
  const dateText = dateActive
    ? view.from && view.to
      ? view.from === view.to
        ? longDate(view.from)
        : `${longDate(view.from)} – ${longDate(view.to)}`
      : view.from
        ? `From ${longDate(view.from)}`
        : `Until ${longDate(view.to)}`
    : "Any date";

  /* ── Render ─────────────────────────────────────────────────────────── */

  return (
    <div className="ibx" data-open={open !== null}>
      {/* ── The list ─────────────────────────────────────────────────── */}
      <section className="ibx-list" aria-label="Conversations">
        <header className="ibx-head">
          <div className="ibx-title-row">
            <div className="ibx-title-block">
              <h1 className="ibx-title">Inbox</h1>
              <button
                type="button"
                className="ibx-sync"
                data-state={statusState}
                aria-expanded={statusOpen}
                onClick={() => setStatusOpen((v) => !v)}
                disabled={!live}
              >
                <span className="ibx-sync-dot" aria-hidden="true" />
                <span className="ibx-sync-text">{statusText}</span>
              </button>
            </div>
            <div className="ibx-head-actions">
              {stats.unread > 0 && (
                <button
                  type="button"
                  className="ibx-icon-btn"
                  title="Mark everything as read"
                  aria-label="Mark everything as read"
                  onClick={markAllRead}
                >
                  <Icon d={I.check} />
                </button>
              )}
              {live && alerts !== "unsupported" && (
                <button
                  type="button"
                  className="ibx-icon-btn"
                  data-on={alerts === "granted"}
                  title={
                    alerts === "granted"
                      ? "Alerts are on while the inbox is open"
                      : alerts === "denied"
                        ? "Alerts are blocked in this browser's settings"
                        : "Turn on alerts for new messages"
                  }
                  aria-label="New-message alerts"
                  disabled={alerts !== "default"}
                  onClick={() => void enableAlerts()}
                >
                  <Icon d={alerts === "denied" ? I.bellOff : I.bell} />
                </button>
              )}
            </div>
          </div>

          {statusOpen && live && (
            <div className="ibx-status" role="region" aria-label="Sync details">
              <ul className="ibx-status-list">
                {accounts.map((a) => {
                  const r = runs[a.id];
                  const m = metas[a.id];
                  const n = stats.byAccount.get(a.id) ?? 0;
                  const history = m?.complete
                    ? "all history saved"
                    : r?.state === "history"
                      ? "saving older…"
                      : r?.state === "paused"
                        ? "older paused"
                        : "older not saved yet";
                  return (
                    <li key={a.id} className="ibx-status-row" data-state={r?.state ?? "waiting"}>
                      <span className="ibx-status-name">
                        <span className="ibx-dot" data-brand={a.brand} aria-hidden="true" />
                        {a.label}
                      </span>
                      <span className="ibx-status-detail">
                        {count(n)} saved · {history}
                      </span>
                      {r?.note && <span className="ibx-status-note">{r.note}</span>}
                    </li>
                  );
                })}
              </ul>
              <div className="ibx-status-actions">
                <button type="button" className="ibx-btn" disabled={checking} onClick={() => void checkNewest()}>
                  {checking ? "Checking…" : "Check now"}
                </button>
                {historyRunning ? (
                  <button type="button" className="ibx-btn" onClick={() => (stopHistory.current = true)}>
                    Pause older
                  </button>
                ) : (
                  historyLeft && (
                    <button type="button" className="ibx-btn" onClick={() => void runHistory()}>
                      Continue older
                    </button>
                  )
                )}
                {pausedHistory.length > 0 && !historyRunning && (
                  <button type="button" className="ibx-btn" onClick={restartHistory}>
                    Restart older from the top
                  </button>
                )}
                {cacheOk && (
                  <button type="button" className="ibx-btn ibx-btn-danger" onClick={() => void clearSaved()}>
                    Clear saved chats
                  </button>
                )}
              </div>
              <p className="ibx-status-foot">
                {cacheOk
                  ? "Saved in this browser, for you only. Monza AI's servers keep no copy."
                  : "This browser is not allowing saved data (a private window?), so conversations load from Meta on every visit."}
              </p>
            </div>
          )}

          {brands.length > 0 && (
            <nav className="ibx-brands" aria-label="Brand">
              {["all", ...brands].map((b) => {
                const s =
                  b === "all"
                    ? { total: all.length, unread: stats.unread }
                    : stats.byBrand.get(b) ?? { total: 0, unread: 0 };
                return (
                  <button
                    key={b}
                    type="button"
                    className="ibx-brand"
                    data-brand={b}
                    aria-pressed={view.brand === b}
                    onClick={() => setView((v) => ({ ...v, brand: b }))}
                  >
                    {b !== "all" && <span className="ibx-dot" data-brand={b} aria-hidden="true" />}
                    <span className="ibx-brand-name">{b === "all" ? "All" : brandLabel(b)}</span>
                    {s.unread > 0 ? (
                      <span className="ibx-badge" aria-label={`${s.unread} unread`}>
                        {s.unread > 99 ? "99+" : s.unread}
                      </span>
                    ) : (
                      <span className="ibx-brand-count">{count(s.total)}</span>
                    )}
                  </button>
                );
              })}
            </nav>
          )}

          <label className="ibx-search">
            <Icon d={I.search} size={16} />
            <input
              type="search"
              placeholder="Search a name, @username or message"
              value={view.search}
              onChange={(e) => setView((v) => ({ ...v, search: e.target.value }))}
              aria-label="Search conversations"
            />
          </label>

          <div className="ibx-chips" role="group" aria-label="Filters">
            {SHOW_FILTERS.map((s: ShowFilter) => (
              <button
                key={s}
                type="button"
                className="ibx-chip"
                aria-pressed={view.show === s}
                onClick={() => setView((v) => ({ ...v, show: s }))}
              >
                {SHOW_LABEL[s]}
              </button>
            ))}
            {channels.length > 1 && <span className="ibx-chip-sep" aria-hidden="true" />}
            {channels.length > 1 &&
              channels.map((ch) => (
                <button
                  key={ch}
                  type="button"
                  className="ibx-chip"
                  data-channel={ch}
                  aria-pressed={view.channel === ch}
                  onClick={() => setView((v) => ({ ...v, channel: v.channel === ch ? "all" : ch }))}
                >
                  {CHANNEL_LABEL[ch]}
                </button>
              ))}
            <button
              type="button"
              className="ibx-chip ibx-chip-date"
              aria-pressed={dateActive}
              aria-expanded={datesOpen}
              onClick={() => setDatesOpen((v) => !v)}
            >
              <Icon d={I.calendar} size={14} />
              {dateText}
            </button>
          </div>

          {datesOpen && (
            <div className="ibx-dates" role="group" aria-label="Last message between">
              <div className="ibx-date-fields">
                <label>
                  <span>From</span>
                  <input type="date" value={view.from} max={view.to || undefined} onChange={(e) => setDates(e.target.value, view.to)} />
                </label>
                <label>
                  <span>To</span>
                  <input type="date" value={view.to} min={view.from || undefined} onChange={(e) => setDates(view.from, e.target.value)} />
                </label>
              </div>
              <div className="ibx-date-presets">
                {DATE_PRESETS.map((p) => {
                  const r = presetRange(p.id as DatePreset, today);
                  const on = view.from === r.from && view.to === r.to;
                  return (
                    <button key={p.id} type="button" className="ibx-chip" aria-pressed={on} onClick={() => setDates(r.from, r.to)}>
                      {p.label}
                    </button>
                  );
                })}
                <button type="button" className="ibx-chip" aria-pressed={!dateActive} onClick={() => setDates("", "")}>
                  Any date
                </button>
              </div>
              <p className="ibx-dates-note">
                By the date of the latest message.
                {historyRunning || historyLeft ? " Older conversations are still being saved, so earlier dates may fill in." : ""}
              </p>
            </div>
          )}

          <div className="ibx-summary">
            <span>
              {count(visible.length)} conversation{visible.length === 1 ? "" : "s"}
              {isFiltered(view) ? ` of ${count(all.length)}` : ""}
            </span>
            {isFiltered(view) && (
              <button type="button" className="ibx-link" onClick={() => setView(EMPTY_VIEW)}>
                Clear filters
              </button>
            )}
          </div>

          {!live && (
            <p className="ibx-demo-note">
              Example conversations — no channel is connected yet. Customer details come from{" "}
              {sourceLabel.toLowerCase()}.
            </p>
          )}
        </header>

        <div className="ibx-scroll">
          {!mounted || !ready ? (
            <ul className="ibx-skeleton" aria-label="Loading">
              {Array.from({ length: 8 }, (_, i) => (
                <li key={i}>
                  <span className="ibx-sk-av" />
                  <span className="ibx-sk-lines">
                    <span />
                    <span />
                  </span>
                </li>
              ))}
            </ul>
          ) : visible.length === 0 ? (
            <div className="ibx-list-empty">
              <p className="ibx-list-empty-title">
                {all.length === 0
                  ? checking
                    ? "Fetching your conversations…"
                    : troubled.length > 0
                      ? "Could not load conversations from Meta"
                      : "No conversations yet"
                  : "Nothing matches"}
              </p>
              <p className="ibx-list-empty-text">
                {all.length === 0
                  ? troubled.length > 0
                    ? "Open the status line above to see what each account said."
                    : "New messages appear here as they arrive."
                  : historyRunning
                    ? "Older conversations are still being saved — this may change."
                    : "Try another brand, filter or date."}
              </p>
            </div>
          ) : (
            <ol className="ibx-days">
              {groups.map((g) => (
                <li key={g.day} className="ibx-day">
                  <h2 className="ibx-day-label">{g.label}</h2>
                  <ul className="ibx-rows">
                    {g.items.map((c) => {
                      const brand = brandOf(c, accounts);
                      const acct = accountById.get(c.accountId ?? accountIdOf(c.id) ?? "");
                      const unread = unreadOf(c);
                      return (
                        <li key={c.id}>
                          <button
                            type="button"
                            className="ibx-row"
                            data-unread={unread}
                            data-profile-id={live && c.channel !== "whatsapp" ? c.id : undefined}
                            aria-current={openId === c.id ? "true" : undefined}
                            onClick={() => openConversation(c)}
                          >
                            <Avatar name={c.customerName} brand={brand} channel={c.channel} picture={profiles[c.id]?.pictureUrl} />
                            <span className="ibx-row-main">
                              <span className="ibx-row-top">
                                <span className="ibx-row-name">{c.customerName}</span>
                                <time className="ibx-row-time" dateTime={c.lastMessage.at}>
                                  {localClock(c.lastMessage.at)}
                                </time>
                              </span>
                              <span className="ibx-row-preview">
                                {c.lastMessage.direction === "out" && c.lastMessage.text !== "" && (
                                  <span className="ibx-you">
                                    {c.lastMessage.author === "automation" ? "Auto: " : "You: "}
                                  </span>
                                )}
                                {c.lastMessage.text || "Open to read the latest message"}
                              </span>
                              <span className="ibx-row-meta">
                                {brand && (
                                  <span className="ibx-tag" data-brand={brand}>
                                    {brandLabel(brand)}
                                  </span>
                                )}
                                <span className="ibx-row-acct">
                                  {acct ? `${CHANNEL_LABEL[c.channel]} · ${acct.handle}` : CHANNEL_LABEL[c.channel]}
                                </span>
                                {unread && <span className="ibx-unread-dot" aria-label="Unread" />}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
              {shown.length < visible.length && (
                <li ref={sentinelRef} className="ibx-more">
                  Showing {count(shown.length)} of {count(visible.length)}…
                </li>
              )}
            </ol>
          )}
        </div>
      </section>

      {/* ── The conversation ─────────────────────────────────────────── */}
      <section className="ibx-thread" aria-label="Conversation">
        {!open ? (
          <div className="ibx-welcome">
            <div className="ibx-welcome-mark" aria-hidden="true">
              <Icon d={I.chat} size={28} />
            </div>
            <h2 className="ibx-welcome-title">Pick a conversation</h2>
            <p className="ibx-welcome-text">
              {!ready
                ? "Opening your saved conversations…"
                : stats.unread > 0
                  ? `${count(stats.unread)} unread across every brand.`
                  : "You are all caught up."}
            </p>
            {brands.length > 0 && ready && (
              <ul className="ibx-welcome-brands">
                {brands.map((b) => {
                  const s = stats.byBrand.get(b) ?? { total: 0, unread: 0 };
                  return (
                    <li key={b}>
                      <button
                        type="button"
                        className="ibx-welcome-brand"
                        data-brand={b}
                        onClick={() => setView((v) => ({ ...v, brand: b, show: s.unread > 0 ? "unread" : "all" }))}
                      >
                        <span className="ibx-dot" data-brand={b} aria-hidden="true" />
                        <span className="ibx-welcome-brand-name">{brandLabel(b)}</span>
                        <span className="ibx-welcome-brand-num">{count(s.total)} chats</span>
                        {s.unread > 0 && <span className="ibx-badge">{s.unread}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : (
          <div className="ibx-conv-grid" data-details={detailsOpen}>
            <div
              className="ibx-conv"
              onDragOver={
                canAttach
                  ? (e) => {
                      if (e.dataTransfer.types.includes("Files")) e.preventDefault();
                    }
                  : undefined
              }
              onDrop={
                canAttach
                  ? (e) => {
                      const f = e.dataTransfer.files?.[0];
                      if (f) {
                        e.preventDefault();
                        setDropped(f);
                      }
                    }
                  : undefined
              }
            >
              <header className="ibx-conv-head">
                <button
                  type="button"
                  className="ibx-icon-btn ibx-back"
                  aria-label="Back to conversations"
                  onClick={() => setOpenId(null)}
                >
                  <Icon d={I.back} />
                </button>
                <Avatar
                  name={open.customerName}
                  brand={openBrand}
                  channel={open.channel}
                  large
                  picture={openProfile?.pictureUrl}
                />
                <div className="ibx-conv-who">
                  <h2 className="ibx-conv-name">
                    {openProfile?.name ?? open.customerName}
                    {openProfile?.verified ? " ✔" : ""}
                  </h2>
                  <p className="ibx-conv-sub">
                    {openBrand && (
                      <span className="ibx-tag" data-brand={openBrand}>
                        {brandLabel(openBrand)}
                      </span>
                    )}
                    <span>
                      {CHANNEL_LABEL[open.channel]}
                      {openAccount ? ` · to ${openAccount.handle}` : ""}
                    </span>
                    {open.channel === "whatsapp" && open.peerPhone && open.peerPhone !== open.customerName && (
                      <span className="ibx-conv-num">{open.peerPhone}</span>
                    )}
                    {openProfile?.username && openProfile.name && <span>@{openProfile.username}</span>}
                    {openProfile?.followers != null && <span>{count(openProfile.followers)} followers</span>}
                    {openProfile?.followsYou && <span className="ibx-follows">Follows you</span>}
                  </p>
                </div>
                {live && (
                  <span
                    className="ibx-window"
                    data-open={thread.windowOpen}
                    data-loading={thread.loading && thread.messages.length === 0}
                    title={thread.windowText}
                  >
                    {thread.loading && thread.messages.length === 0
                      ? "Checking…"
                      : thread.windowOpen
                        ? "Reply window open"
                        : "Reply window closed"}
                  </span>
                )}
                {open.channel === "whatsapp" && waWebChatLink(open.peerPhone) && (
                  // Calls cannot ring inside MONZA AI on a number shared with the
                  // phone app (Meta refuses Coexistence numbers). This opens the
                  // customer's chat in WhatsApp Web, one click from its call button.
                  <a
                    className="ibx-icon-btn ibx-call"
                    href={waWebChatLink(open.peerPhone) ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    title="Call on WhatsApp — opens this chat in WhatsApp Web, where the call button is"
                    aria-label="Call on WhatsApp"
                  >
                    <Icon d={I.phone} />
                  </a>
                )}
                <button
                  type="button"
                  className="ibx-icon-btn"
                  aria-pressed={detailsOpen}
                  aria-label="Customer details"
                  title="Customer details"
                  onClick={() => setDetailsOpen((v) => !v)}
                >
                  <Icon d={I.info} />
                </button>
              </header>

              <div className="ibx-conv-body" ref={bodyRef}>
                {live && thread.loading && messages.length === 0 && (
                  <p className="ibx-conv-note">Loading the conversation from Meta…</p>
                )}
                {live && thread.problem && <p className="ibx-conv-note is-urgent">{thread.problem}</p>}
                {messageGroups.map((g) => (
                  <section key={g.day} className="ibx-msg-day" aria-label={g.label}>
                    <div className="ibx-msg-sep">
                      <span>{g.label}</span>
                    </div>
                    {g.items.map((m) => (
                      <div
                        key={m.id}
                        className={`ibx-bubble ibx-bubble-${m.direction}`}
                        data-author={m.author}
                        data-media={m.attachments && m.attachments.length > 0 ? "true" : undefined}
                      >
                        {m.attachments && m.attachments.length > 0 && (
                          <Attachments items={m.attachments} onOpenImage={openImage} />
                        )}
                        {m.text !== "" && <p className="ibx-bubble-text">{m.text}</p>}
                        {m.text !== "" && <LinkEmbeds text={m.text} />}
                        <p className="ibx-bubble-meta">
                          {m.author === "automation"
                            ? `Automatic · ${m.automationId ?? ""}`
                            : m.author === "staff"
                              ? m.staffName ?? "Monza"
                              : open.customerName}
                          {" · "}
                          {localClock(m.at)}
                          {m.direction === "out" &&
                            (live ? (
                              <>
                                {" "}
                                <Ticks status={m.status} error={m.error} />
                              </>
                            ) : m.status !== "sent" ? (
                              ` · ${m.status}`
                            ) : (
                              ""
                            ))}
                        </p>
                      </div>
                    ))}
                  </section>
                ))}
                {live && open.channel !== "whatsapp" && messages.length >= 20 && (
                  <p className="ibx-conv-foot">Meta shares the latest 20 messages of a conversation.</p>
                )}
              </div>

              {viewer && (
                <Lightbox
                  images={viewer.images}
                  index={viewer.index}
                  onIndex={(i) => setViewer((v) => (v ? { ...v, index: i } : v))}
                  onClose={() => setViewer(null)}
                />
              )}

              <div className="ibx-compose-wrap">
                {/* Suggested drafts read the example threads only; on a live
                    thread they would draft from the wrong conversation. */}
                {!live && (
                  <DraftDock
                    conversationId={open.id}
                    anchorMessageId={anchorMessageId}
                    onUse={(text) => {
                      setComposerText(text);
                      composerRef.current?.focus();
                    }}
                  />
                )}
                <div className="ibx-compose">
                  <textarea
                    ref={composerRef}
                    className="ibx-composer"
                    rows={1}
                    placeholder="Write a reply…"
                    value={composerText}
                    onChange={(e) => {
                      setComposerText(e.target.value);
                      e.target.style.height = "auto";
                      e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && live) {
                        e.preventDefault();
                        void sendReply();
                      }
                    }}
                    onPaste={(e) => {
                      // A pasted screenshot or photo opens the attach sheet, like WhatsApp.
                      const f = canAttach ? e.clipboardData?.files?.[0] : undefined;
                      if (f) {
                        e.preventDefault();
                        setDropped(f);
                      }
                    }}
                    aria-label="Your reply"
                  />
                  <div className="ibx-compose-actions">
                    {canAttach && (
                      <MediaComposer
                        conversationId={open.id}
                        channel={open.channel}
                        enabled={thread.windowOpen && !sending}
                        disabledReason={
                          thread.windowOpen
                            ? "Wait for the reply to finish sending."
                            : thread.windowText || "The reply window is closed."
                        }
                        dropped={dropped}
                        onDroppedTaken={takeDropped}
                        onSent={mediaSent}
                        onNote={setSendNote}
                      />
                    )}
                    <button
                      type="button"
                      className="ibx-icon-btn"
                      title="Copy the reply"
                      aria-label="Copy the reply"
                      disabled={composerText === ""}
                      onClick={() => void navigator.clipboard?.writeText(composerText)}
                    >
                      <Icon d={I.copy} size={16} />
                    </button>
                    {live ? (
                      <button
                        type="button"
                        className="ibx-send"
                        disabled={sending || composerText.trim() === "" || !thread.windowOpen}
                        onClick={() => void sendReply()}
                      >
                        <Icon d={I.send} size={16} />
                        {sending ? "Sending…" : "Send"}
                      </button>
                    ) : open.channel === "whatsapp" ? (
                      <a
                        className="ibx-send"
                        href={waLink(open.peerPhone ?? open.channelAddress, composerText)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open in WhatsApp
                      </a>
                    ) : (
                      <span className="ibx-send" aria-disabled="true">
                        Not connected
                      </span>
                    )}
                  </div>
                </div>
                <p className="ibx-compose-note" role="status">
                  {live
                    ? sendNote ?? (thread.loading ? "Checking the conversation…" : `${thread.windowText} Ctrl+Enter sends.${canAttach ? " Drop a file here, or use 📎 and 🎤." : ""}`)
                    : open.channel === "whatsapp"
                      ? "Nothing is sent from Monza AI — opening WhatsApp fills this in and you tap send."
                      : `${CHANNEL_LABEL[open.channel]} replies are not connected yet.`}
                </p>
              </div>
            </div>

            {detailsOpen && (
              <aside className="ibx-details" aria-label="Customer details">
                <div className="ibx-details-head">
                  <h3>Details</h3>
                  <button
                    type="button"
                    className="ibx-icon-btn"
                    aria-label="Close details"
                    onClick={() => setDetailsOpen(false)}
                  >
                    <Icon d={I.x} size={16} />
                  </button>
                </div>

                {live && <ProfileCard key={open.id} conv={open} profile={openProfile} />}

                <div className="ibx-card">
                  <p className="ibx-card-title">Conversation</p>
                  <dl className="ibx-facts">
                    <dt>Name</dt>
                    <dd>{open.customerName}</dd>
                    <dt>Brand</dt>
                    <dd>{openBrand ? brandLabel(openBrand) : "—"}</dd>
                    <dt>Wrote to</dt>
                    <dd>{openAccount ? openAccount.label : CHANNEL_LABEL[open.channel]}</dd>
                    <dt>Last message</dt>
                    <dd>{mounted ? `${longDate(localDay(open.lastMessage.at))}, ${localClock(open.lastMessage.at)}` : ""}</dd>
                  </dl>
                </div>

                {!customer && live && (
                  <div className="ibx-card">
                    <p className="ibx-card-title">Not linked to a customer yet</p>
                    <p className="ibx-card-text">
                      {open.channel === "whatsapp"
                        ? "No CRM customer is linked to this number yet."
                        : "Instagram and Facebook do not share phone numbers, so this person is matched once they give one."}
                    </p>
                  </div>
                )}

                {customer && (
                  <div className="ibx-card">
                    <p className="ibx-card-title">{customer.name}</p>
                    <ul className="ibx-card-list">
                      {customer.handles.map((h) => (
                        <li key={`${h.channel}-${h.address}`}>
                          {CHANNEL_LABEL[h.channel]} · {h.address}
                        </li>
                      ))}
                    </ul>
                    <p className="ibx-card-text">
                      First contact {customer.firstContact} · {customer.origin}
                    </p>
                    <Link className="ibx-link" href={`/customers?open=${customer.id}`}>
                      Open customer
                    </Link>
                  </div>
                )}

                {customerVehicles.map((v) => (
                  <div className="ibx-card" key={v.id}>
                    <p className="ibx-card-title">{v.label}</p>
                    <p className="ibx-card-text">
                      {v.plate ? `${v.plate} · ` : ""}
                      {VEHICLE_STATUS_LABEL[v.status]}
                      {v.awaitingPart ? ` — ${v.awaitingPart}` : ""}
                    </p>
                    {v.jobReference && <p className="ibx-card-text">Job {v.jobReference}</p>}
                  </div>
                ))}

                {customerInstallments.length > 0 && (
                  <div className="ibx-card">
                    <p className="ibx-card-title">Outstanding installments</p>
                    <ul className="ibx-card-list">
                      {customerInstallments.map((i) => (
                        <li key={i.id} className={i.status === "overdue" ? "is-urgent" : ""}>
                          #{i.number} of {i.totalCount} · {usd(i.amountUsd)} · {longDate(i.dueDate)}
                        </li>
                      ))}
                    </ul>
                    <p className="ibx-card-text">
                      Reported by the source system — Monza AI keeps no balance of its own.
                    </p>
                  </div>
                )}

                {demo && (
                  <p className="ibx-card-text">Customer details come from {sourceLabel.toLowerCase()}.</p>
                )}
              </aside>
            )}
          </div>
        )}
      </section>

      {toast && (
        <div className="ibx-toast" role="status">
          <Avatar name={toast.customerName} brand={brandOf(toast, accounts)} channel={toast.channel} />
          <div className="ibx-toast-main">
            <p className="ibx-toast-title">
              {toast.customerName} · {brandLabel(brandOf(toast, accounts))}
            </p>
            <p className="ibx-toast-text">{toast.lastMessage.text}</p>
          </div>
          <button
            type="button"
            className="ibx-btn"
            onClick={() => {
              openConversation(toast);
              setToast(null);
            }}
          >
            Open
          </button>
          <button type="button" className="ibx-icon-btn" aria-label="Dismiss" onClick={() => setToast(null)}>
            <Icon d={I.x} size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
