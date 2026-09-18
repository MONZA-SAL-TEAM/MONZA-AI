/**
 * What the Meta webhook does with customer messages that were NEW
 * (lib/channels/store.ts `fresh`: a Meta redelivery is never new, so nothing
 * here happens twice). SERVER ONLY.
 *
 *   PILOT chats (lib/wasales/autoreply-pilot.ts)   the sales bot answers by
 *                                                  itself — the one exception
 *                                                  to CLAUDE.md rule 24
 *   EVERY OTHER customer (Samer, 2026-09-17)       nothing is sent, but the
 *                                                  message is read and the chat
 *                                                  is marked for a person, so
 *                                                  "a non-pilot customer never
 *                                                  disappears because the bot
 *                                                  is disabled for them"
 *
 * Nothing here decides what to say: that is the same engine, templates and
 * checks a person's "Send this" uses (suggestion-server.ts autoreplyThread).
 */

import type { FreshInbound } from "@/lib/channels/store";
import { listAccounts, readWhatsAppMessages } from "@/lib/channels/store";
import { encodeThreadId } from "@/lib/channels/live-map";
import { metaThreadFor } from "@/lib/channels/live";
import { autoreplyMode, isPilotChat } from "@/lib/wasales/autoreply-pilot";
import { autoreplyThread } from "@/lib/wasales/suggestion-server";
import { folderMedia, loadCatalog } from "@/lib/wasales/catalog";
import { MONZA_KNOWLEDGE } from "@/lib/wasales/knowledge";
import { recordAlert } from "@/lib/wasales/sales-ops";
import { triageInbound, type Triage } from "@/lib/wasales/triage";
import { NO_TEXT } from "@/lib/channels/live-map";
import { WA_ATTACHMENT_ONLY } from "@/lib/channels/whatsapp";

export interface AutoreplyIo {
  /** Answer a pilot chat. */
  autoreply: (threadId: string, arrivedAt: string, deadlineMs: number) => Promise<{ sent: number; rounds: number; stopped: string }>;
  /** Mark a chat outside the pilot for a person. Returns true when an alert exists for it. */
  markForPerson: (f: FreshInbound) => Promise<boolean>;
}

export interface AutoreplyOutcome {
  /** Pilot chats answered. */
  chats: number;
  sent: number;
  /** Chats outside the pilot marked for a person. */
  marked: number;
}

/** At most this many non-pilot chats are triaged per delivery; the rest stay unread in the inbox. */
const MAX_MARKED_PER_DELIVERY = 20;

export async function runAutoreply(
  fresh: readonly FreshInbound[],
  budgetMs: number,
  io: AutoreplyIo = defaultIo
): Promise<AutoreplyOutcome> {
  const mode = autoreplyMode(process.env.SALES_AUTOREPLY_MODE);

  // One run per chat, woken by the EARLIEST new message of this delivery, so
  // every message in it is part of the conversation the engine answers.
  const pilot = new Map<string, FreshInbound>();
  const others = new Map<string, FreshInbound>();
  for (const f of fresh) {
    const into = isPilotChat(f) ? pilot : others;
    const seen = into.get(f.conversationId);
    if (!seen || Date.parse(f.at) < Date.parse(seen.at)) into.set(f.conversationId, f);
  }

  const deadline = Date.now() + budgetMs;
  let sent = 0;
  let chats = 0;
  if (mode !== "off") {
    for (const f of pilot.values()) {
      // WhatsApp threads are ours; an Instagram or Facebook thread is Meta's, found
      // from the customer's id (a webhook does not name the conversation).
      const threadId =
        f.channel === "whatsapp"
          ? encodeThreadId(f.accountId, f.conversationId)
          : await metaThreadFor(f.accountId, f.peerExternalId);
      if (!threadId) {
        console.info(`[sales/autoreply] ${f.accountId}: could not find the conversation on Meta`);
        continue;
      }
      chats++;
      const r = await io.autoreply(threadId, f.at, deadline);
      sent += r.sent;
      // Counts and reasons only — no customer words, no phone number.
      console.info(`[sales/autoreply] ${f.accountId}: rounds ${r.rounds}, sent ${r.sent}, stopped: ${r.stopped}`);
    }
  }

  // Everyone else: read, never answered, always marked. Even with the bot off.
  let marked = 0;
  for (const f of [...others.values()].slice(0, MAX_MARKED_PER_DELIVERY)) {
    if (Date.now() > deadline) break;
    try {
      if (await io.markForPerson(f)) marked++;
    } catch (e) {
      console.error(`[sales/triage] ${f.accountId}: could not mark the chat for a person:`, e);
    }
  }
  return { chats, sent, marked };
}

/* ── The real world ──────────────────────────────────────────────────────── */

/** The customer's newest WhatsApp message, as words and whether it carried a file. */
async function latestWhatsAppInbound(f: FreshInbound): Promise<{ text: string; hasMedia: boolean } | null> {
  const read = await readWhatsAppMessages(f.accountId, f.conversationId, 5);
  if (!read.ok || !read.value) return null;
  const row = read.value.rows.find((r) => r.direction === "in");
  if (!row) return null;
  const text = (row.body ?? "").trim();
  const placeholder = text === NO_TEXT || text === WA_ATTACHMENT_ONLY;
  return {
    text: placeholder ? "" : text,
    hasMedia: placeholder || (Array.isArray(row.attachments) && row.attachments.length > 0),
  };
}

async function markForPerson(f: FreshInbound): Promise<boolean> {
  const account = (await listAccounts()).find((a) => a.id === f.accountId);
  if (!account) return false;

  // Instagram and Facebook words are never stored (Samer, 2026-09-10): the mark says only that
  // a customer wrote. WhatsApp is stored, so its message can be read and classified.
  let triage: Triage = { kind: "NEEDS_PERSON", tags: ["NEEDS_PERSON"], urgency: "normal", models: [], reason: "Bot not switched on for this chat: a new customer message." };
  let threadId: string | null;
  if (f.channel === "whatsapp") {
    threadId = encodeThreadId(f.accountId, f.conversationId);
    const latest = await latestWhatsAppInbound(f);
    if (latest) {
      const t = triageInbound(
        { text: latest.text, hasMedia: latest.hasMedia, brand: account.brand, now: f.at },
        { knowledge: MONZA_KNOWLEDGE, catalog: loadCatalog(), media: folderMedia, ttlHours: 72 }
      );
      if (t === null) return false; // not a customer: a scam, a vendor, a test
      triage = t;
    }
  } else {
    threadId = await metaThreadFor(f.accountId, f.peerExternalId);
    if (!threadId) return false;
  }

  return recordAlert(
    {
      accountId: account.id,
      brand: account.brand,
      conversationRef: f.conversationId,
      threadId,
      customerPhone: f.channel === "whatsapp" ? f.peerExternalId.replace(/\D/g, "") || null : null,
    },
    { kind: triage.kind, tags: triage.tags, urgency: triage.urgency, models: triage.models, name: null, phone: null, slot: null, reason: triage.reason }
  );
}

const defaultIo: AutoreplyIo = { autoreply: autoreplyThread, markForPerson };
