/**
 * SALES SUGGESTIONS in the inbox — the Search Engine's answer to a real chat,
 * for a PERSON to send (Samer, 2026-09-15: "suggest only, never automatic").
 *
 * Pure: a chat's messages and what was remembered go in, a suggestion comes
 * out. The server (suggestion-server.ts) reads the chat live from Meta — or
 * from our store for WhatsApp — and sends only when somebody presses Send.
 *
 * WHICH MESSAGES IT ANSWERS: the customer's messages since our last reply,
 * read together as one ("hi" + "courage" + "price?" is one question), and only
 * those from the last SALES_CONTEXT_TTL_HOURS — a question from three weeks
 * ago is not part of today's.
 *
 * WHEN IT STOPS — "quiet for the rest of the chat" (Samer, 2026-09-15): the
 * moment a reply on our side was written by a person rather than sent from a
 * suggestion. Ours are recognised by Meta's own message ids, saved when they
 * were sent, and — on WhatsApp, which we store — by their automation id.
 * Anything else outgoing (typed in the inbox, the WhatsApp Business app,
 * Business Suite, the Instagram app) hands the chat to people for good, unless
 * staff press "Suggest again", which forgives the replies written until then.
 */

import { runTurn, type TurnResult } from "@/lib/wasales/flow";
import { freshState, type SearchEngineState } from "@/lib/wasales/context";
import type { EngineDeps } from "@/lib/wasales/engine";
import type { SalesChannel } from "@/lib/wasales/knowledge";
import type { InboxMessage } from "@/lib/inbox/types";
import { NO_TEXT } from "@/lib/channels/live-map";
import { WA_ATTACHMENT_ONLY } from "@/lib/channels/whatsapp";

/** The automation id a suggestion's WhatsApp messages are recorded with. */
export const SUGGESTION_AUTOMATION_PREFIX = "sales-suggestion";

/** …and the sales autoreply pilot's (lib/wasales/autoreply.ts). */
export const AUTOREPLY_AUTOMATION_PREFIX = "sales-autoreply";

/** How many of our sent message ids are remembered per chat. */
export const MAX_REMEMBERED_IDS = 500;

/** What is remembered about one chat (migration 012). */
export interface SavedSuggestion {
  state: SearchEngineState;
  /** Meta's ids of the messages sent from suggestions in this chat. */
  sentMessageIds: string[];
  /** "Suggest again": replies a person wrote at or before this are forgiven. */
  resumedAt: string | null;
  /**
   * Where the conversation the engine sees BEGINS: every message at or before
   * this is ignored, ours and theirs. Set when the autoreply pilot first
   * answers a chat, so earlier tests and staff replies are not part of it.
   */
  startedAt: string | null;
  /** 0 = nothing saved yet. Bumped on every save. */
  rev: number;
}

export function freshSaved(): SavedSuggestion {
  return { state: freshState(), sentMessageIds: [], resumedAt: null, startedAt: null, rev: 0 };
}

export interface ThreadFacts {
  /** The receiving account's brand — never read from the chat (rule 1). */
  brand: string;
  channel: SalesChannel;
  messages: readonly InboxMessage[];
  windowOpen: boolean;
  /**
   * The headline of the ad or post this chat started from ("Voyah COURAGE"), as Meta sent it with the
   * FIRST message (lead_touchpoints). Soft context for the engine: it answers "how much is it?" when the
   * customer names no car, and never locks the chat to that car.
   */
  adHeadline?: string | null;
  /** A TEST phone of the pilot (autoreply-pilot.ts `alwaysAnswer`): a person's reply does not pause the bot here. */
  alwaysAnswer?: boolean;
}

/**
 * HUMAN TAKEOVER (Samer, 2026-09-17: "a human reply should pause automation
 * temporarily, not permanently"). A reply typed by a person pauses the bot
 * while that conversation is live: the bot stays out until the chat has been
 * quiet for RESUME_HOURS after the person's last reply. A customer who comes
 * back later with a new question is then read again, and only the messages
 * after the person's last reply are answered. "Hand this chat to a person"
 * (state.manualTakeover) holds the bot out until "Suggest again".
 */
export const DEFAULT_HANDOVER_RESUME_HOURS = 12;

/**
 * Engine reasons that mean a customer is waiting for a person, not a quiet "ok":
 * a photo with no words, text the rules do not read, another brand's car. The
 * autoreply marks the chat "Needs a person" on these, so nobody is silently ignored.
 */
export function needsPerson(reasons: readonly string[]): boolean {
  return reasons.some((r) => /a person (reads|looks|says|answers)|asked for a person|switched off|another brand/i.test(r));
}

export function handoverResumeHours(raw: string | undefined | null): number {
  if (typeof raw !== "string" || !/^\s*\d{1,3}\s*$/.test(raw)) return DEFAULT_HANDOVER_RESUME_HOURS;
  const h = Number(raw.trim());
  return h >= 1 && h <= 168 ? h : DEFAULT_HANDOVER_RESUME_HOURS;
}

export type Suggestion =
  /** A person is in this chat: the bot waits. */
  | { kind: "handed_over"; reason: string; since: string; manual: boolean }
  /** Our reply is the latest, or the customer has not written. */
  | { kind: "nothing_to_answer"; reason: string }
  | {
      kind: "suggestion";
      turn: TurnResult;
      /** The customer messages this answers. */
      answered: string[];
      /** Changes when they, or what was remembered, change. A send names it. */
      version: string;
    };

/** Was this outgoing message sent by the sales engine (a suggestion or the pilot)? */
export function isOurs(m: InboxMessage, saved: SavedSuggestion): boolean {
  const automation = m.automationId ?? "";
  return (
    saved.sentMessageIds.includes(m.id) ||
    automation.startsWith(`${SUGGESTION_AUTOMATION_PREFIX}:`) ||
    automation.startsWith(`${AUTOREPLY_AUTOMATION_PREFIX}:`)
  );
}

/** The customer's own words — the inbox's "open the app to see it" is ours, not theirs. */
function customerWords(m: InboxMessage): string {
  const t = m.text.trim();
  return t === NO_TEXT || t === WA_ATTACHMENT_ONLY ? "" : t;
}

function carriesMedia(m: InboxMessage): boolean {
  const t = m.text.trim();
  return (m.attachments?.length ?? 0) > 0 || t === NO_TEXT || t === WA_ATTACHMENT_ONLY;
}

/** FNV-1a, 32 bits: a short, stable fingerprint — not a secret. */
function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function timeOf(m: InboxMessage): number {
  const t = Date.parse(m.at);
  return Number.isFinite(t) ? t : 0;
}

export function suggestForThread(
  facts: ThreadFacts,
  saved: SavedSuggestion,
  deps: EngineDeps,
  opts: { liveSending: boolean; resumeHours?: number }
): Suggestion {
  const resumeHours = opts.resumeHours ?? DEFAULT_HANDOVER_RESUME_HOURS;
  const started = saved.startedAt ? Date.parse(saved.startedAt) : NaN;
  const ordered = [...facts.messages]
    .filter((m) => !(Number.isFinite(started) && timeOf(m) <= started))
    .sort((a, b) => timeOf(a) - timeOf(b));
  const resumed = saved.resumedAt ? Date.parse(saved.resumedAt) : NaN;

  const outs = ordered.filter((m) => m.direction === "out");
  const byPerson = outs.filter(
    (m) => !isOurs(m, saved) && !(Number.isFinite(resumed) && timeOf(m) <= resumed)
  );
  if (saved.state.manualTakeover) {
    return {
      kind: "handed_over",
      reason: "Staff handed this chat to a person. Press \"Suggest again\" to switch the bot back on.",
      since: byPerson[byPerson.length - 1]?.at ?? saved.resumedAt ?? ordered[ordered.length - 1]?.at ?? "",
      manual: true,
    };
  }
  if (byPerson.length > 0 && !facts.alwaysAnswer) {
    const lastHuman = byPerson[byPerson.length - 1];
    const lastHumanAt = timeOf(lastHuman);
    const customerSince = ordered.filter((m) => m.direction === "in" && timeOf(m) > lastHumanAt);
    const latestIn = customerSince[customerSince.length - 1];
    const quietMs = latestIn ? timeOf(latestIn) - lastHumanAt : 0;
    // The person is in the conversation: the bot does not jump into the middle of it.
    if (!latestIn || quietMs < resumeHours * 3_600_000) {
      return {
        kind: "handed_over",
        reason: `A person has replied in this chat. The bot stays out until the chat has been quiet for ${resumeHours} hours after their last reply.`,
        since: lastHuman.at,
        manual: false,
      };
    }
    // Quiet long enough: the person's conversation is over, and the customer is back with something new.
  }

  const lastOut = outs.length > 0 ? timeOf(outs[outs.length - 1]) : -Infinity;
  const waiting = ordered.filter((m) => m.direction === "in" && timeOf(m) > lastOut);
  if (waiting.length === 0) {
    return {
      kind: "nothing_to_answer",
      reason: outs.length > 0 ? "Our reply is the latest message." : "The customer has not written yet.",
    };
  }

  const latest = waiting[waiting.length - 1];
  const horizon = timeOf(latest) - deps.ttlHours * 3_600_000;
  const answered = waiting.filter((m) => timeOf(m) >= horizon);

  const turn = runTurn(
    {
      text: answered.map(customerWords).filter((t) => t !== "").join("\n"),
      hasMedia: answered.some(carriesMedia),
      brand: facts.brand,
      channel: facts.channel,
      conversationIsNew: outs.length === 0,
      now: latest.at,
      ...(facts.adHeadline ? { referral: { headline: facts.adHeadline } } : {}),
    },
    saved.state,
    deps,
    {
      channel: facts.channel,
      // A person presses Send: there is no automatic sending to switch off,
      // and the person IS the human in the loop.
      autoSendEnabled: true,
      humanLock: false,
      replyWindowOpen: facts.windowOpen,
      liveSending: opts.liveSending,
      attachmentsSupported: true,
      linkOversize: true,
    }
  );

  return {
    kind: "suggestion",
    turn,
    answered: answered.map((m) => m.id),
    version: fingerprint(`${saved.rev}|${facts.brand}|${answered.map((m) => m.id).join(",")}`),
  };
}

/** What to remember once a suggestion has been sent (or partly sent). */
export function afterSend(
  saved: SavedSuggestion,
  nextState: SearchEngineState | null,
  sentIds: readonly (string | null)[]
): SavedSuggestion {
  return {
    state: nextState ?? saved.state,
    sentMessageIds: [...saved.sentMessageIds, ...sentIds.filter((id): id is string => !!id)].slice(
      -MAX_REMEMBERED_IDS
    ),
    resumedAt: saved.resumedAt,
    startedAt: saved.startedAt,
    rev: saved.rev + 1,
  };
}
