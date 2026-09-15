/**
 * THE CATALOGUE the sales flow actually runs on.
 *
 * Two possible sources, in this order:
 *
 *   1. lib/wasales/sales-manifest.ts — written by
 *      `node scripts/import-sales-folder.mjs "<Monza AI sales>"`. This is the
 *      real one: the models, the colours and the file names all come from the
 *      folder Monza keeps its material in.
 *
 *   2. lib/wasales/catalog-data.ts — the seed. Model names and aliases only,
 *      with NO colours and NO media, used until the folder has been imported.
 *
 * The application never invents a colour. Before the import, every car has an
 * empty colour list and the flow says plainly that nothing can be sent yet;
 * after it, the colours are exactly the folder's subdirectory names.
 *
 * Why a committed file rather than a database table: the catalogue is material,
 * not customer data. It changes when Monza shoots a new video, it is reviewed
 * like code, and having it in the repository means the colour a customer is
 * offered is always traceable to a specific commit.
 */

import { matchTokens, type WaAsset, type WaCar } from "@/lib/wasales/matcher";
import type { WaColour } from "@/lib/wasales/colours";
import type { MediaRef, ModelMedia, ModelMediaLookup } from "@/lib/wasales/knowledge";
import {
  COLOUR_WORDS,
  CUSTOMER_WORDS,
  WASALES_CATALOG,
} from "@/lib/wasales/catalog-data";
import {
  SALES_MANIFEST,
  type ManifestCar,
  type ManifestColour,
  type ManifestFile,
} from "@/lib/wasales/sales-manifest";

const MANIFEST = SALES_MANIFEST;

/** True when the real sales folder has been imported. */
export function catalogueImported(): boolean {
  return MANIFEST.cars.length > 0;
}

/** Where the material came from, for the screen to name honestly. */
export function catalogueSource(): string {
  return catalogueImported()
    ? (MANIFEST.importedFrom ?? "the sales folder")
    : "not imported yet";
}

/** Anything the import flagged for a person to fix. */
export function catalogueWarnings(): readonly string[] {
  return MANIFEST.warnings ?? [];
}

/**
 * Import warnings the Sales screen now checks LIVE against the shared
 * library: an empty colour folder, a car with no catalogue PDF, videos not
 * sorted by colour. Repeating them from the import only goes stale. Two of
 * the three were fixed by uploading straight to the library, and the screen
 * went on saying "3 things need your attention" about problems already solved.
 *
 * The patterns match the exact sentences scripts/import-sales-folder.mjs
 * writes; tests/sales-catalog.test.ts pins them to that file.
 */
export const SUPERSEDED_BY_LIVE_CHECK: readonly RegExp[] = [
  /: folder is empty — cannot be offered\.$/,
  /: no catalogue PDF — it can never auto-send\.$/,
  /: videos are not in colour folders — treated as one option with no colour choice\.$/,
];

/**
 * Warnings about the FOLDER that the library cannot answer: a file over the
 * size limit, the same video filed under two cars, a file named after a
 * different model. These stay on screen until the folder is fixed and
 * re-imported.
 */
export function folderWarnings(): readonly string[] {
  return catalogueWarnings().filter(
    (w) => !SUPERSEDED_BY_LIVE_CHECK.some((pattern) => pattern.test(w))
  );
}

/* ── Mapping ─────────────────────────────────────────────────────────────── */

function toAsset(file: ManifestFile, label: string): WaAsset {
  return { label, fileName: file.fileName };
}

function toColour(c: ManifestColour): WaColour {
  // The colour's own name is always an alias; the importer may add more, and
  // COLOUR_WORDS adds the way customers really ask ("noir", "abyad", "اسود").
  const aliases = new Set<string>([
    c.name.toLowerCase(),
    ...(c.aliases ?? []),
    ...(COLOUR_WORDS[c.id] ?? []),
  ]);
  return { id: c.id, name: c.name, aliases: [...aliases] };
}

/**
 * The import's aliases plus CUSTOMER_WORDS, de-duplicated by how the matcher
 * reads them.
 *
 * An alias containing a bare "i" is dropped. The importer used to write
 * "mhero i" (the catalogue's roman numeral), and that turned "the mhero i saw
 * on instagram" into the Mhero 1. A lone "i" is the pronoun far more often
 * than the numeral; "mhero 1" and "917" cover the real question.
 */
function aliasesFor(m: ManifestCar): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const alias of [...m.aliases, ...(CUSTOMER_WORDS[m.id] ?? [])]) {
    const tokens = matchTokens(alias);
    if (tokens.length === 0 || tokens.includes("i")) continue;
    const key = tokens.join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }
  return out;
}

function toCar(m: ManifestCar): WaCar {
  // EVERY colour the folder has, including ones with no video.
  //
  // Filtering here looked tidy and was wrong twice over: the sales screen
  // could not show that Mhero 1 has a Black folder waiting to be filled, and
  // the decision about what may be OFFERED belongs to the flow, which already
  // makes it — sendableColours() takes the media counts and drops anything
  // with nothing to send. One filter, in the place that owns the rule.
  return {
    id: m.id,
    name: m.name,
    enabled: true,
    aliases: aliasesFor(m),
    // Every video across every colour — what the media screen lists.
    videos: m.colours.flatMap((c) =>
      c.videos.map((v) => toAsset(v, `${m.name} — ${c.name}`))
    ),
    colours: m.colours.map(toColour),
    brochure: m.brochure ? toAsset(m.brochure, `${m.name} catalogue`) : null,
    oneLiner: "",
  };
}

/**
 * The catalogue to run on.
 *
 * Pure and synchronous: it reads a committed file, so the sales screen and the
 * flow can never disagree about what exists, and a test asserts the same thing
 * production runs.
 */
export function loadCatalog(): WaCar[] {
  return catalogueImported() ? MANIFEST.cars.map(toCar) : WASALES_CATALOG;
}

/**
 * How many videos each colour of a car has — the shape the flow needs to know
 * what it may actually offer.
 */
export function mediaIndexFor(car: WaCar): Record<string, number> {
  const counts: Record<string, number> = {};
  const found = MANIFEST.cars.find((c) => c.id === car.id);
  if (!found) {
    // Not imported: nothing can be sent, and the flow will say so.
    for (const colour of car.colours) counts[colour.id] = 0;
    return counts;
  }
  for (const colour of found.colours) counts[colour.id] = colour.videos.length;
  return counts;
}

/** True when this car's videos were not organised by colour (Voyah Dream). */
export function hasNoColourChoice(carId: string): boolean {
  const found = MANIFEST.cars.find((c) => c.id === carId);
  return Boolean(found?.colours.some((c) => c.noColourChoice));
}

/* ── Media, in the shape the Search Engine reads ─────────────────────────── */

/**
 * What the sales FOLDER held for a car at import time. That is what was on
 * somebody's disk, not what can be sent — so the simulator uses it only when
 * asked to preview "as if everything in the folder were uploaded".
 */
export function folderMedia(carId: string): ModelMedia {
  const found = MANIFEST.cars.find((c) => c.id === carId);
  if (!found) return { brochure: null, videosByColour: {} };
  const videosByColour: Record<string, MediaRef[]> = {};
  for (const colour of found.colours) {
    videosByColour[colour.id] = colour.videos.map((v) => ({ name: v.fileName, bytes: v.bytes }));
  }
  return {
    brochure: found.brochure
      ? { name: found.brochure.fileName, bytes: found.brochure.bytes }
      : null,
    videosByColour,
  };
}

/** One uploaded file, as the shared media library lists it. */
export interface LibraryFile {
  carId: string;
  kind: "video" | "brochure";
  /** Which colour a video shows; null for a brochure. */
  colourId: string | null;
  name: string;
  size: number;
}

/**
 * What the shared LIBRARY holds — the truth about what could actually be
 * sent. A video filed under no colour is ignored, because it can never be
 * offered; the first brochure listed is the car's brochure.
 */
export function libraryMedia(files: readonly LibraryFile[]): ModelMediaLookup {
  return (carId) => {
    let brochure: MediaRef | null = null;
    const videosByColour: Record<string, MediaRef[]> = {};
    for (const f of files) {
      if (f.carId !== carId) continue;
      if (f.kind === "brochure") {
        brochure ??= { name: f.name, bytes: f.size };
      } else if (f.colourId) {
        (videosByColour[f.colourId] ??= []).push({ name: f.name, bytes: f.size });
      }
    }
    return { brochure, videosByColour };
  };
}
