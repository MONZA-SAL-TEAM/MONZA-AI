/**
 * Every word the Search Engine can make a customer read — and the executor
 * that turns ordered actions into the messages a channel would carry.
 *
 * The engine decides WHAT (actions.ts); this file decides the WORDS, and only
 * from the fixed sentences below, filled with approved values (a model's
 * display name, a colour's name, an approved fact, the contact number). There
 * is no free text and no model-written sentence anywhere on this path.
 *
 * THE EXECUTOR IS A PLAN, NOT A SENDER. renderPlan() returns the messages in
 * order — text, then the file it introduces — shaped for the channel: quick
 * replies on Instagram and Messenger, reply buttons or a list on WhatsApp,
 * and a numbered list wherever the choices do not fit, whose typed answers
 * ("2") the engine reads back. Whether any of it may go out is the send
 * policy's decision (actions.ts), and today the answer is no: nothing here
 * calls a channel.
 *
 * English only, deliberately. Arabic and French versions need a person to
 * write and approve them; until then a customer writing in Arabic is answered
 * in English (the language is recorded, so the gap is measurable).
 *
 * Also here: the SHORT LABELS staff read on /sales ("SEND COURAGE BROCHURE"),
 * kept beside the customer wording so the two cannot drift.
 */

import type { EngineAction, FallbackReason } from "@/lib/wasales/actions";
import { colourPayload, modelPayload, type FactIntent, type GlobalIntent } from "@/lib/wasales/intent";
import {
  CHANNEL_LIMITS,
  modelByCode,
  type ModelCode,
  type SalesBrand,
  type SalesChannel,
  type SalesKnowledge,
} from "@/lib/wasales/knowledge";

/* ── Output shape ────────────────────────────────────────────────────────── */

export interface Choice {
  title: string;
  /** The stable payload the engine reads back: MODEL:COURAGE, COLOUR:COURAGE:BLACK. */
  payload: string;
}

export type ChoiceStyle = "quick_replies" | "buttons" | "list" | "numbered";

export type OutboundPart =
  | { kind: "text"; text: string; choices: Choice[]; style: ChoiceStyle | null }
  | { kind: "file"; fileKind: "document" | "video"; name: string; bytes: number | null };

export interface RenderContext {
  channel: SalesChannel;
  brand: SalesBrand;
  knowledge: SalesKnowledge;
}

/* ── The words ───────────────────────────────────────────────────────────── */

export const BRAND_NAME: Readonly<Record<SalesBrand, string>> = {
  voyah: "Voyah Lebanon",
  mhero: "MHERO Lebanon",
  monza: "Monza",
};

const FACT_LABEL: Readonly<Record<FactIntent, string>> = {
  HORSEPOWER: "Horsepower",
  RANGE: "Range",
  BATTERY: "Battery",
  POWERTRAIN: "Powertrain",
  CHARGING: "Charging",
  SEATS: "Seats",
  DIMENSIONS: "Dimensions",
  SPECIFICATIONS: "Specifications",
  WARRANTY: "Warranty",
};

const GLOBAL_LEAD: Readonly<Record<GlobalIntent, string>> = {
  LOCATION: "Our showroom",
  OPENING_HOURS: "Our opening hours",
  CONTACT_NUMBER: "Our number",
};

/** Samer's sentence, exactly (2026-09-14). */
export function contactFallbackText(k: SalesKnowledge): string {
  return `For more information, please call ${k.contact.display}.`;
}

function listWords(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

function nameOf(k: SalesKnowledge, code: ModelCode): string {
  return modelByCode(k, code)?.displayName ?? code;
}

/** WhatsApp list rows allow a few more characters than buttons do. */
const WHATSAPP_LIST_TITLE = 24;

/** A question with its choices, shaped for the channel. */
function question(text: string, choices: Choice[], channel: SalesChannel): OutboundPart {
  const limits = CHANNEL_LIMITS[channel];
  const fit = (max: number) => choices.every((c) => c.title.length <= max);
  if (choices.length <= limits.quickReplies && fit(limits.choiceTitleChars)) {
    return {
      kind: "text",
      text,
      choices,
      style: channel === "whatsapp" ? "buttons" : "quick_replies",
    };
  }
  if (choices.length <= limits.listRows && fit(WHATSAPP_LIST_TITLE)) {
    return { kind: "text", text, choices, style: "list" };
  }
  const lines = choices.map((c, i) => `${i + 1}. ${c.title}`).join("\n");
  return {
    kind: "text",
    text: `${text}\n${lines}\nReply with the number.`,
    choices,
    style: "numbered",
  };
}

function say(text: string): OutboundPart {
  return { kind: "text", text, choices: [], style: null };
}

/**
 * The messages the actions would produce, in order. Internal actions
 * (CONTENT_GAP, FLAG_FOR_STAFF) produce nothing a customer sees.
 */
export function renderPlan(actions: readonly EngineAction[], ctx: RenderContext): OutboundPart[] {
  const k = ctx.knowledge;
  const parts: OutboundPart[] = [];
  for (const a of actions) {
    switch (a.type) {
      case "SEND_BROCHURE":
        parts.push(say(`Here is the ${nameOf(k, a.model)} brochure.`));
        parts.push({ kind: "file", fileKind: "document", name: a.asset.name, bytes: a.asset.bytes });
        break;
      case "SEND_FACT":
        parts.push(say(`${FACT_LABEL[a.fact]} of the ${nameOf(k, a.model)}: ${a.value}.`));
        break;
      case "SEND_GLOBAL_INFO":
        parts.push(say(`${GLOBAL_LEAD[a.key]}: ${a.value}.`));
        break;
      case "SEND_COLOUR_VIDEO": {
        const car = nameOf(k, a.model);
        const text = a.onlyOption
          ? `Here is a video of the ${car}.`
          : a.chosenForThem
            ? `Here is the ${car} in ${a.colourName} — a favourite of ours.`
            : `Here is the ${car} in ${a.colourName}.`;
        parts.push(say(text));
        parts.push({ kind: "file", fileKind: "video", name: a.asset.name, bytes: a.asset.bytes });
        break;
      }
      case "COLOUR_NOT_AVAILABLE":
        parts.push(
          say(`Sorry — we don't have a video of the ${nameOf(k, a.model)} in ${a.requested}.`)
        );
        break;
      case "SEND_CONTACT_FALLBACK":
        parts.push(say(contactFallbackText(k)));
        break;
      case "SHOW_COLOUR_CHOICES":
        parts.push(
          question(
            `Which colour would you like to see? We can show you the ` +
              `${nameOf(k, a.model)} in ${listWords(a.colours.map((c) => c.name))}.`,
            a.colours.map((c) => ({ title: c.name, payload: colourPayload(a.model, c.id) })),
            ctx.channel
          )
        );
        break;
      case "SHOW_MODEL_CHOICES": {
        const lead = a.greet ? `Hello and welcome to ${BRAND_NAME[ctx.brand]}! ` : "";
        const ask = a.narrowed
          ? "Which one are you interested in?"
          : "Which model are you interested in?";
        parts.push(
          question(
            `${lead}${ask}`,
            a.models.map((m) => ({ title: nameOf(k, m), payload: modelPayload(m) })),
            ctx.channel
          )
        );
        break;
      }
      case "CONTENT_GAP":
      case "FLAG_FOR_STAFF":
        break;
    }
  }
  return parts;
}

/** The plan as plain lines, for the simulator and for logs. */
export function planLines(parts: readonly OutboundPart[]): string[] {
  return parts.map((p) =>
    p.kind === "file"
      ? `[${p.fileKind === "document" ? "PDF" : "Video"}: ${p.name}]`
      : p.choices.length > 0 && p.style !== "numbered"
        ? `${p.text} [${p.style}: ${p.choices.map((c) => c.title).join(" | ")}]`
        : p.text
  );
}

/* ── Staff labels ────────────────────────────────────────────────────────── */

function label(code: string): string {
  return code.replace(/_/g, " ");
}

/** One fallback reason, as staff read it. */
export function reasonLabel(r: FallbackReason): string {
  switch (r.kind) {
    case "CONTACT_INTENT":
      return r.model ? `${label(r.intent)} (${label(r.model)})` : label(r.intent);
    case "MISSING_FACT":
      return `${r.status} FACT ${label(r.model)} / ${label(r.fact)}`;
    case "MISSING_GLOBAL":
      return `${r.status} ${label(r.key)}`;
    case "CONTACT_NUMBER":
      return "ASKED FOR THE NUMBER";
    case "MISSING_BROCHURE":
      return `NO BROCHURE ${label(r.model)}`;
    case "NO_COLOUR_MEDIA":
      return `NO COLOUR VIDEOS ${label(r.model)}`;
    case "CROSS_BRAND":
      return `OTHER BRAND ${label(r.model)}`;
    case "MORE_INFO":
      return `MORE INFO ${label(r.model)}`;
    case "MODEL_SWITCHED_OFF":
      return `SWITCHED OFF ${label(r.model)}`;
  }
}

/** "SEND COURAGE BROCHURE", "SHOW COURAGE COLOURS" — the simulator's action list. */
export function actionLabel(a: EngineAction): string {
  switch (a.type) {
    case "SEND_BROCHURE":
      return `SEND ${label(a.model)} BROCHURE`;
    case "SEND_FACT":
      return `SEND ${label(a.model)} ${label(a.fact)}`;
    case "SEND_GLOBAL_INFO":
      return `SEND ${label(a.key)}`;
    case "SEND_COLOUR_VIDEO":
      return `SEND ${label(a.model)} ${a.colourName.toUpperCase()} VIDEO`;
    case "COLOUR_NOT_AVAILABLE":
      return `${label(a.model)} ${a.requested.toUpperCase()} NOT AVAILABLE`;
    case "SEND_CONTACT_FALLBACK":
      return `SEND CONTACT FALLBACK — ${a.reasons.map(reasonLabel).join("; ")}`;
    case "SHOW_COLOUR_CHOICES":
      return `SHOW ${label(a.model)} COLOURS`;
    case "SHOW_MODEL_CHOICES":
      return `SHOW MODEL CHOICES (${a.models.map(label).join(", ")})`;
    case "CONTENT_GAP":
      return a.detail;
    case "FLAG_FOR_STAFF":
      return `FLAG FOR STAFF — ${a.reason}`;
  }
}
