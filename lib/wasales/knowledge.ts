/**
 * THE KNOWLEDGE the Search Engine is allowed to use — and the only place it
 * comes from.
 *
 * Three kinds of thing live here, each with its own rule:
 *
 *   MODELS   the eight cars, which brand sells each, and the catalogue folder
 *            holding its brochure, colours and videos (lib/wasales/catalog.ts).
 *            Files are never listed here: what exists is what was uploaded,
 *            and the caller supplies that (ModelMediaLookup).
 *
 *   FACTS    horsepower, range, battery … per model, as ApprovedFact
 *            {value, approved, source}. A fact is SENT only when it is
 *            approved and has a real value. Nothing here was typed from
 *            memory or copied from the internet. The few values present are
 *            Monza's own captions, read from its own video file names, and
 *            recorded UNAPPROVED with the caption quoted as the source so a
 *            person can approve or correct each one. Until then the engine
 *            answers with the contact number, exactly as if the value were
 *            missing — and the readiness report lists it.
 *
 *   GLOBAL   location, opening hours, contact number. Only the contact number
 *            is approved (Samer, 2026-09-14). Location and hours are missing,
 *            and the engine says so rather than guessing.
 *
 * Also here, because it is knowledge about the channels rather than a rule:
 * what each channel accepts (file sizes, formats, how many choice buttons).
 *
 * Customer text never reaches this module. Nothing in a message can change a
 * fact, a price, a brand or a number: the exported knowledge is deep-frozen
 * and the engine only ever reads it.
 */

import { matchModel, type WaCar } from "@/lib/wasales/matcher";
import { WORKBOOK } from "@/lib/wasales/knowledge-data";
import type { FactIntent, GlobalIntent } from "@/lib/wasales/intent";

/* ── Brands and models ───────────────────────────────────────────────────── */

/** The brand of the RECEIVING account — never read from what a customer wrote. */
export type SalesBrand = "voyah" | "mhero" | "monza";

export const MODEL_CODES = [
  "FREE_318",
  "COURAGE",
  "DREAM",
  "PASSION",
  "PASSION_L",
  "TAISHAN",
  "MHERO_1",
  "MHERO_2",
] as const;

export type ModelCode = (typeof MODEL_CODES)[number];

export type FactKey = FactIntent;
export type GlobalKey = GlobalIntent;

export interface ApprovedFact {
  readonly value: string;
  /** Only an approved fact is ever sent. */
  readonly approved: boolean;
  /** Where the value came from, for the person approving it. */
  readonly source: string;
}

export interface ModelKnowledge {
  readonly code: ModelCode;
  /** The marque. MONZA SAL accounts sell both; each brand account sells its own. */
  readonly brand: "voyah" | "mhero";
  readonly displayName: string;
  /** The catalogue car (lib/wasales/catalog.ts) holding its brochure, colours and videos. */
  readonly catalogueId: string;
  /** EV, EREV or PHEV: what "which EVs / hybrids do you have?" filters on. */
  readonly bucket: PowertrainBucket;
  /** Seats as a number, for "7 seater?"; null when the workbook does not state it. */
  readonly seatCount: number | null;
  readonly facts: Readonly<Partial<Record<FactKey, ApprovedFact>>>;
}

export type PowertrainBucket = "EV" | "EREV" | "PHEV";

/** The fixed sentences of the showroom (workbook, B Showroom). */
export interface ShowroomText {
  readonly welcome: string;
  /** "For further assistance, please contact us on 70 70 85 85." */
  readonly handoff: string;
  /** Service, maintenance, spare parts and vehicle problems. */
  readonly serviceContact: string;
  readonly serviceNumber: string;
  /** Administration numbers, for the department menu. */
  readonly administration: string;
}

export interface ContactNumber {
  /** As dialled. */
  readonly digits: string;
  /** As written to a customer. */
  readonly display: string;
}

export interface SalesKnowledge {
  readonly models: readonly ModelKnowledge[];
  readonly global: Readonly<Partial<Record<GlobalKey, ApprovedFact>>>;
  readonly contact: ContactNumber;
  readonly showroom: ShowroomText;
  /**
   * Ad or referral `ref` → model, ONLY where the mapping is known to be
   * right. Empty: no ad has been set up to carry a model yet, and a model is
   * never guessed from an ad, a story or a photo.
   */
  readonly referrals: Readonly<Record<string, ModelCode>>;
}

/** Freeze an object and everything inside it. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const inner of Object.values(value as Record<string, unknown>)) {
      deepFreeze(inner);
    }
    Object.freeze(value);
  }
  return value;
}

const WORKBOOK_SOURCE =
  "Samer's workbook Monza-Bot-Reply-Worksheet-Master-Logic-Expanded.xlsx, A Car Facts (2026-09-17)";

/** One model's facts, as the workbook approved them (knowledge-data.ts). */
function workbookFacts(code: ModelCode): Partial<Record<FactKey, ApprovedFact>> {
  const out: Partial<Record<FactKey, ApprovedFact>> = {};
  for (const [key, fact] of Object.entries(WORKBOOK.models[code].facts)) {
    // A value the workbook says is not stated is kept EMPTY: the bot says so, never guesses.
    out[key as FactKey] = { value: fact.confirmed ? fact.value : "", approved: true, source: WORKBOOK_SOURCE };
  }
  return out;
}

function workbookModel(code: ModelCode, brand: "voyah" | "mhero"): ModelKnowledge {
  const m = WORKBOOK.models[code];
  return {
    code,
    brand,
    displayName: m.officialName,
    catalogueId: m.catalogueId,
    bucket: m.bucket,
    seatCount: m.seatCount,
    facts: workbookFacts(code),
  };
}

const SHOWROOM_SOURCE = "Samer's workbook, B Showroom (2026-09-17)";

/**
 * The knowledge the product runs on. Every fact and fixed sentence comes from
 * Samer's workbook: scripts/sales-import-workbook.py regenerates
 * knowledge-data.ts from it (Samer, 2026-09-17: "this is the brain of the chat bot").
 */
export const MONZA_KNOWLEDGE: SalesKnowledge = deepFreeze({
  models: [
    workbookModel("FREE_318", "voyah"),
    workbookModel("COURAGE", "voyah"),
    workbookModel("DREAM", "voyah"),
    workbookModel("PASSION", "voyah"),
    workbookModel("PASSION_L", "voyah"),
    workbookModel("TAISHAN", "voyah"),
    workbookModel("MHERO_1", "mhero"),
    workbookModel("MHERO_2", "mhero"),
  ],
  global: {
    LOCATION: {
      value: [WORKBOOK.showroom.location, WORKBOOK.showroom.mapsLink].filter(Boolean).join("\n"),
      approved: true,
      source: SHOWROOM_SOURCE,
    },
    OPENING_HOURS: {
      value: [WORKBOOK.showroom.hoursWeek, WORKBOOK.showroom.hoursSaturday, WORKBOOK.showroom.hoursSunday].join("\n"),
      approved: true,
      source: SHOWROOM_SOURCE,
    },
    CONTACT_NUMBER: {
      value: WORKBOOK.showroom.salesContact,
      approved: true,
      source: SHOWROOM_SOURCE,
    },
  },
  contact: { digits: "70708585", display: "70 70 85 85" },
  showroom: {
    welcome: WORKBOOK.showroom.welcome,
    handoff: WORKBOOK.showroom.handoff,
    serviceContact: WORKBOOK.showroom.serviceContact,
    serviceNumber: "76 877 278",
    administration: WORKBOOK.showroom.administration,
  },
  referrals: {},
});

export const SALES_BRANDS: readonly SalesBrand[] = ["voyah", "mhero", "monza"];

/** The account's brand as the engine knows it, or null for anything else. */
export function salesBrandOf(brand: string): SalesBrand | null {
  return (SALES_BRANDS as readonly string[]).includes(brand) ? (brand as SalesBrand) : null;
}

export function isModelCode(value: string): value is ModelCode {
  return (MODEL_CODES as readonly string[]).includes(value);
}

export function modelByCode(k: SalesKnowledge, code: string): ModelKnowledge | null {
  return k.models.find((m) => m.code === code) ?? null;
}

export function modelByCatalogueId(k: SalesKnowledge, id: string): ModelKnowledge | null {
  return k.models.find((m) => m.catalogueId === id) ?? null;
}

/** Does an account of this brand sell this model? MONZA SAL sells both marques. */
export function brandSells(brand: SalesBrand, model: ModelKnowledge): boolean {
  return brand === "monza" || model.brand === brand;
}

/** The models an account of this brand may offer, in knowledge order. */
export function modelsForBrand(k: SalesKnowledge, brand: SalesBrand): ModelKnowledge[] {
  return k.models.filter((m) => brandSells(brand, m));
}

/* ── Facts ───────────────────────────────────────────────────────────────── */

/**
 * The five states a fact can be in, kept apart because they need different
 * fixes: MISSING (nobody entered it), UNAPPROVED (entered, not signed off),
 * EMPTY (approved with no value), ZERO (approved as a bare 0 — a placeholder,
 * never a real horsepower or range), OK.
 */
export type FactStatus = "OK" | "MISSING" | "UNAPPROVED" | "EMPTY" | "ZERO";

const BARE_ZERO = /^\s*0+(?:[.,]0+)?\s*[\p{L}%]*\s*$/u;

export function factStatus(fact: ApprovedFact | undefined | null): FactStatus {
  if (!fact) return "MISSING";
  if (!fact.approved) return "UNAPPROVED";
  if (fact.value.trim() === "") return "EMPTY";
  if (BARE_ZERO.test(fact.value)) return "ZERO";
  return "OK";
}

export interface FactLookup {
  status: FactStatus;
  fact: ApprovedFact | null;
}

export function lookupFact(model: ModelKnowledge, key: FactKey): FactLookup {
  const fact = model.facts[key] ?? null;
  return { status: factStatus(fact), fact };
}

export function lookupGlobal(k: SalesKnowledge, key: GlobalKey): FactLookup {
  const fact = k.global[key] ?? null;
  return { status: factStatus(fact), fact };
}

/* ── Media ───────────────────────────────────────────────────────────────── */

/** One file that could be sent: its name and size as the library reports them. */
export interface MediaRef {
  readonly name: string;
  /** null when the source cannot say — which blocks sending it. */
  readonly bytes: number | null;
  /**
   * The shared library's public address, which a channel fetches when the
   * file is sent. Absent for a file that is only in the sales folder: it
   * cannot be sent until somebody uploads it.
   */
  readonly url?: string | null;
}

/** What has actually been uploaded for one catalogue car. */
export interface ModelMedia {
  readonly brochure: MediaRef | null;
  /** colour id → its videos, in library order. */
  readonly videosByColour: Readonly<Record<string, readonly MediaRef[]>>;
}

export type ModelMediaLookup = (catalogueId: string) => ModelMedia;

export const NO_MEDIA: ModelMedia = deepFreeze({ brochure: null, videosByColour: {} });

/** colour id → number of videos, the shape sendableColours() takes. */
export function videoCounts(media: ModelMedia): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [colour, files] of Object.entries(media.videosByColour)) out[colour] = files.length;
  return out;
}

/* ── What each channel accepts ───────────────────────────────────────────── */

export type SalesChannel = "instagram" | "facebook" | "whatsapp";

export interface ChannelLimits {
  readonly label: string;
  readonly videoBytes: number;
  readonly documentBytes: number;
  /** Accepted video file extensions; null when the channel names none. */
  readonly videoExtensions: readonly string[] | null;
  /** Tappable quick replies / reply buttons per message. */
  readonly quickReplies: number;
  /** Rows in a list message (WhatsApp); 0 where the channel has none. */
  readonly listRows: number;
  /** Characters allowed on one choice's title. */
  readonly choiceTitleChars: number;
}

/**
 * As Meta documents them (checked 2026-09-14; re-verify before go-live).
 * Megabytes are DECIMAL here on purpose: the smaller reading of "25 MB" can
 * never let through a file the platform then rejects.
 */
export const CHANNEL_LIMITS: Readonly<Record<SalesChannel, ChannelLimits>> = deepFreeze({
  instagram: {
    label: "Instagram",
    videoBytes: 25_000_000,
    documentBytes: 25_000_000,
    videoExtensions: ["mp4", "mov", "ogg", "avi", "webm"],
    quickReplies: 13,
    listRows: 0,
    choiceTitleChars: 20,
  },
  facebook: {
    label: "Messenger",
    videoBytes: 25_000_000,
    documentBytes: 25_000_000,
    videoExtensions: null,
    quickReplies: 13,
    listRows: 0,
    choiceTitleChars: 20,
  },
  whatsapp: {
    label: "WhatsApp",
    videoBytes: 16_000_000,
    documentBytes: 100_000_000,
    videoExtensions: ["mp4", "3gp"],
    quickReplies: 3,
    listRows: 10,
    choiceTitleChars: 20,
  },
});

export const SALES_CHANNELS: readonly SalesChannel[] = ["instagram", "facebook", "whatsapp"];

function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** Why this file cannot go out on this channel, or null when it can. */
export function mediaFitsChannel(
  ref: MediaRef,
  kind: "video" | "document",
  channel: SalesChannel
): string | null {
  const limits = CHANNEL_LIMITS[channel];
  if (ref.bytes === null) return `${limits.label}: file size unknown`;
  const max = kind === "video" ? limits.videoBytes : limits.documentBytes;
  if (ref.bytes > max) {
    return `${limits.label}: ${megabytes(ref.bytes)} is over the ${megabytes(max)} limit`;
  }
  if (kind === "video" && limits.videoExtensions) {
    const dot = ref.name.lastIndexOf(".");
    const ext = dot >= 0 ? ref.name.slice(dot + 1).toLowerCase() : "";
    if (!limits.videoExtensions.includes(ext)) {
      return `${limits.label}: .${ext || "?"} video is not accepted`;
    }
  }
  return null;
}

/* ── Content readiness (per model) ───────────────────────────────────────── */

export const FACT_KEYS: readonly FactKey[] = [
  "HORSEPOWER",
  "RANGE",
  "BATTERY",
  "POWERTRAIN",
  "CHARGING",
  "SEATS",
  "DIMENSIONS",
  "SPECIFICATIONS",
  "WARRANTY",
];

export interface ColourReadiness {
  id: string;
  name: string;
  videos: readonly MediaRef[];
  /** Channels the first video cannot go out on, with the reason. */
  blockedOn: string[];
}

export interface ModelReadiness {
  code: ModelCode;
  displayName: string;
  brand: "voyah" | "mhero";
  catalogueId: string;
  inCatalogue: boolean;
  aliases: string[];
  brochure: MediaRef | null;
  brochureBlockedOn: string[];
  colours: ColourReadiness[];
  facts: { key: FactKey; status: FactStatus; value: string | null; source: string | null }[];
  /** Plain sentences: what is missing and what it costs. */
  gaps: string[];
}

export interface ReadinessReport {
  models: ModelReadiness[];
  global: { key: GlobalKey; status: FactStatus; value: string | null }[];
  /** Problems across models: shared files, aliases that land on another car. */
  problems: string[];
}

/**
 * What each model can really do today, and what is missing — the content
 * validation behind the simulator's readiness panel and its tests.
 */
export function readinessReport(
  k: SalesKnowledge,
  catalog: readonly WaCar[],
  media: ModelMediaLookup
): ReadinessReport {
  const problems: string[] = [];
  const models: ModelReadiness[] = [];

  // Where every file name sits, to catch one file filed under two models —
  // the exact mistake that once put a Passion L video in the Passion folder.
  const filedUnder = new Map<string, Set<ModelCode>>();
  const note = (name: string, code: ModelCode) => {
    const key = name.trim().toLowerCase();
    if (!filedUnder.has(key)) filedUnder.set(key, new Set());
    filedUnder.get(key)?.add(code);
  };

  const cars = k.models
    .map((m) => catalog.find((c) => c.id === m.catalogueId))
    .filter((c): c is WaCar => Boolean(c));

  for (const model of k.models) {
    const car = catalog.find((c) => c.id === model.catalogueId) ?? null;
    const have = car ? media(car.id) : NO_MEDIA;
    const gaps: string[] = [];

    if (!car) gaps.push("Not in the sales catalogue — nothing can be sent for it.");
    const expectedPrefix = model.brand === "mhero" ? "mhero-" : "voyah-";
    if (!model.catalogueId.startsWith(expectedPrefix)) {
      problems.push(`${model.displayName}: catalogue folder "${model.catalogueId}" does not look like a ${model.brand} car.`);
    }

    const brochureBlockedOn = have.brochure
      ? SALES_CHANNELS.map((ch) => mediaFitsChannel(have.brochure as MediaRef, "document", ch)).filter(
          (r): r is string => r !== null
        )
      : [];
    if (have.brochure) {
      note(have.brochure.name, model.code);
      if (brochureBlockedOn.length > 0) gaps.push(`Brochure cannot go out on ${brochureBlockedOn.join("; ")}.`);
    } else {
      gaps.push("No brochure — every activation falls back to the contact number.");
    }

    const colours: ColourReadiness[] = (car?.colours ?? []).map((colour) => {
      const videos = have.videosByColour[colour.id] ?? [];
      for (const v of videos) note(v.name, model.code);
      const blockedOn =
        videos.length > 0
          ? SALES_CHANNELS.map((ch) => mediaFitsChannel(videos[0], "video", ch)).filter(
              (r): r is string => r !== null
            )
          : [];
      return { id: colour.id, name: colour.name, videos, blockedOn };
    });
    const withVideo = colours.filter((c) => c.videos.length > 0);
    if (car && withVideo.length === 0) {
      gaps.push("No colour has a video — colour choices cannot be shown.");
    }
    for (const c of colours) {
      if (c.videos.length === 0) gaps.push(`${c.name}: no video — never offered.`);
      else if (c.blockedOn.length > 0) gaps.push(`${c.name} video cannot go out on ${c.blockedOn.join("; ")}.`);
    }

    const facts = FACT_KEYS.map((key) => {
      const { status, fact } = lookupFact(model, key);
      return { key, status, value: fact?.value ?? null, source: fact?.source ?? null };
    });
    const missing = facts.filter((f) => f.status !== "OK");
    if (missing.length > 0) {
      const unapproved = missing.filter((f) => f.status === "UNAPPROVED").map((f) => f.key);
      gaps.push(
        `${FACT_KEYS.length - missing.length} of ${FACT_KEYS.length} facts approved` +
          (unapproved.length > 0 ? `; awaiting approval: ${unapproved.join(", ")}` : "") +
          " — every other fact question gets the contact number."
      );
    }

    // Every alias must bring the customer to THIS car and no other.
    const aliases = car ? [...car.aliases] : [];
    for (const alias of aliases) {
      const landed = matchModel(alias, cars).model?.id;
      if (landed && landed !== model.catalogueId) {
        const other = modelByCatalogueId(k, landed);
        problems.push(`${model.displayName}: the alias "${alias}" lands on ${other?.displayName ?? landed}.`);
      }
    }

    models.push({
      code: model.code,
      displayName: model.displayName,
      brand: model.brand,
      catalogueId: model.catalogueId,
      inCatalogue: car !== null,
      aliases,
      brochure: have.brochure,
      brochureBlockedOn,
      colours,
      facts,
      gaps,
    });
  }

  for (const [name, codes] of filedUnder) {
    if (codes.size > 1) {
      problems.push(`The file "${name}" is filed under ${[...codes].join(" and ")} — one of them is wrong.`);
    }
  }

  const global = (["LOCATION", "OPENING_HOURS", "CONTACT_NUMBER"] as const).map((key) => {
    const { status, fact } = lookupGlobal(k, key);
    return { key, status, value: fact?.value ?? null };
  });

  return { models, global, problems };
}
