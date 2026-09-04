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

import type { WaAsset, WaCar } from "@/lib/wasales/matcher";
import type { WaColour } from "@/lib/wasales/colours";
import { WASALES_CATALOG } from "@/lib/wasales/catalog-data";
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

/* ── Mapping ─────────────────────────────────────────────────────────────── */

function toAsset(file: ManifestFile, label: string): WaAsset {
  return { label, fileName: file.fileName };
}

function toColour(c: ManifestColour): WaColour {
  // The colour's own name is always an alias; the importer may add more, and a
  // person can add the way customers really ask ("noir", "abyad") later.
  const aliases = new Set<string>([c.name.toLowerCase(), ...(c.aliases ?? [])]);
  return { id: c.id, name: c.name, aliases: [...aliases] };
}

function toCar(m: ManifestCar): WaCar {
  // A colour with no video cannot be sent, so it is not offered. It still
  // exists in the folder, and the import report says so — the gap belongs on
  // the dashboard, not in a customer's chat.
  const sendable = m.colours.filter((c) => c.videos.length > 0);

  return {
    id: m.id,
    name: m.name,
    enabled: true,
    aliases: m.aliases,
    // Every video across every colour — what the media screen lists.
    videos: m.colours.flatMap((c) =>
      c.videos.map((v) => toAsset(v, `${m.name} — ${c.name}`))
    ),
    colours: sendable.map(toColour),
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
