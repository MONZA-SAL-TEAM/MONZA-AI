/**
 * Sending ONE sales suggestion that a person approved — never on its own
 * (Samer, 2026-09-15: "suggest only, never automatic").
 *
 * The parts go out in the order the templates made them — the sentence before
 * the file it introduces, the question last — one Meta request each, and it
 * stops at the first that fails: the rest of the answer would read wrong
 * without it. Before anything is sent the whole plan is checked, so a plan
 * that could not go out whole does not start.
 *
 * Files are never uploaded from here. Each goes by its public address in the
 * sales library, which the channel fetches itself.
 */

import { sendWhatsAppChoices, sendWhatsAppLink, sendWhatsAppText } from "@/lib/channels/whatsapp";
import { fileMessage, postMetaMessage, textMessage } from "@/lib/channels/meta-send";
import type { OutboundPart } from "@/lib/wasales/templates";

/** Where the plan goes, as the send gates resolved it (lib/channels/live.ts). */
export type SendTarget =
  | { channel: "whatsapp"; phoneNumberId: string; to: string; token: string }
  | { channel: "facebook" | "instagram"; host: string; recipientId: string; token: string };

export interface SentPart {
  index: number;
  /** Meta's id for it — null when Meta accepted it without one. */
  externalMessageId: string | null;
  kind: "text" | "choices" | "document" | "video";
  /** What our copy of the thread shows for it (WhatsApp is stored). */
  record: string;
}

export interface ExecutionResult {
  sent: SentPart[];
  /** The part that failed, and why — null when every part went. */
  failed: { index: number; problem: string; windowClosed: boolean } | null;
}

type PartResult =
  | { ok: true; externalMessageId: string | null }
  | { ok: false; problem: string; windowClosed: boolean };

/** Why this plan cannot go out whole, or null when it can. */
export function checkPlan(parts: readonly OutboundPart[]): string | null {
  if (parts.length === 0) return "There is nothing to send.";
  for (const p of parts) {
    if (p.kind === "file") {
      if (!p.url) return `${p.name} is not in the shared library yet — upload it on /sales first.`;
      if (!/^https:\/\/\S+$/.test(p.url)) return "A file's address is not a secure web link.";
    } else if (p.text.trim() === "") {
      return "An empty message cannot be sent.";
    }
  }
  return null;
}

function kindOf(p: OutboundPart): SentPart["kind"] {
  if (p.kind === "file") return p.fileKind;
  return p.choices.length > 0 && p.style !== "numbered" ? "choices" : "text";
}

function recordOf(p: OutboundPart): string {
  if (p.kind === "file") return `${p.fileKind === "document" ? "Brochure" : "Video"}: ${p.name}`;
  if (p.choices.length > 0 && p.style !== "numbered") {
    return `${p.text}\n${p.choices.map((c) => `• ${c.title}`).join("\n")}`;
  }
  return p.text;
}

async function sendPart(p: OutboundPart, target: SendTarget, fetchFn: typeof fetch): Promise<PartResult> {
  if (target.channel === "whatsapp") {
    const base = { phoneNumberId: target.phoneNumberId, to: target.to };
    if (p.kind === "file") {
      return sendWhatsAppLink(
        {
          ...base,
          kind: p.fileKind,
          link: p.url ?? "",
          ...(p.fileKind === "document" ? { filename: p.name } : {}),
        },
        target.token,
        fetchFn
      );
    }
    if (p.choices.length > 0 && (p.style === "buttons" || p.style === "list")) {
      return sendWhatsAppChoices(
        { ...base, body: p.text, style: p.style, choices: p.choices.map((c) => ({ id: c.payload, title: c.title })) },
        target.token,
        fetchFn
      );
    }
    return sendWhatsAppText({ ...base, text: p.text }, target.token, fetchFn);
  }

  const message =
    p.kind === "file"
      ? fileMessage(p.fileKind === "document" ? "file" : "video", p.url ?? "")
      : textMessage(p.text, p.style === "quick_replies" ? p.choices : []);
  return postMetaMessage(
    {
      host: target.host,
      token: target.token,
      recipientId: target.recipientId,
      message,
      messenger: target.channel === "facebook",
    },
    fetchFn
  );
}

/** Send the parts in order; stop at the first that fails. */
export async function executePlan(
  parts: readonly OutboundPart[],
  target: SendTarget,
  fetchFn: typeof fetch = fetch
): Promise<ExecutionResult> {
  const problem = checkPlan(parts);
  if (problem) return { sent: [], failed: { index: 0, problem, windowClosed: false } };

  const sent: SentPart[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const r = await sendPart(p, target, fetchFn);
    if (!r.ok) return { sent, failed: { index: i, problem: r.problem, windowClosed: r.windowClosed } };
    sent.push({ index: i, externalMessageId: r.externalMessageId, kind: kindOf(p), record: recordOf(p) });
  }
  return { sent, failed: null };
}
