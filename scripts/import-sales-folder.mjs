#!/usr/bin/env node
/**
 * Import the Monza sales folder.
 *
 * Reads the real folder Monza keeps its sales material in and produces a
 * MANIFEST: which models exist, which colours each one has, which catalogue
 * PDF belongs to it, and which video files sit under each colour.
 *
 * Nothing about the models or the colours is invented by the application — the
 * folder IS the source of truth, and this script is how it gets in.
 *
 * EXPECTED SHAPE (as it actually is on Jawad's machine):
 *
 *   Monza AI sales/
 *     Car Models/
 *       Voyah Passion L/
 *         Catalog/
 *           VOYAH PASSION L Catalogue 2026.pdf      <- one per car, no colour
 *         Videos/
 *           Black/  <one or more video files>       <- colour = folder name
 *           Grey/   <one or more video files>
 *
 * Two real cases from that folder are handled deliberately:
 *   - a colour folder that is EMPTY (Mhero 1 / Black) — the colour exists on
 *     paper but cannot be sent, so it is recorded and marked unsendable;
 *   - videos sitting DIRECTLY under Videos/ with no colour folder at all
 *     (Voyah Dream) — that car simply has no colour choice, and the flow sends
 *     without asking rather than inventing colours for it.
 *
 * USAGE
 *   node scripts/import-sales-folder.mjs "C:\\Users\\jawad\\Downloads\\Monza AI sales"
 *   node scripts/import-sales-folder.mjs "<folder>" --write
 *
 * Without --write it only reports and changes nothing. With --write it
 * regenerates lib/wasales/sales-manifest.ts, which is what the application
 * reads.
 *
 * It only ever READS the sales folder. Uploading the files themselves is a
 * separate step, once the storage key is set.
 */

import { readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);
const DOC_EXTENSIONS = new Set([".pdf"]);

/** The shared bucket's per-file ceiling. Anything larger needs compressing. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** Files an operating system leaves lying around, never real material. */
const JUNK = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

function isJunk(name) {
  return name.startsWith(".") || JUNK.has(name.toLowerCase());
}

/** "Voyah Passion L" -> "voyah-passion-l". Stable across runs and machines. */
function slug(name) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Words that must NEVER become a bare alias, because they appear in ordinary
 * sentences a customer might send about anything at all.
 *
 * Kept deliberately SHORT. "free" is here because it genuinely misfired once —
 * "feel free to call me" auto-sent a car. "comp"/"one"/"two" are fragments
 * rather than names. Words like "dream", "passion", "courage" and "taishan" are
 * model names people really do type on their own, and excluding them would
 * make the matcher worse, not safer — the most-specific-wins rule already keeps
 * "passion" off the Passion L.
 */
const COMMON_ENGLISH = new Set(["free", "comp", "competition", "one", "two"]);

function aliasesFor(modelName) {
  const out = new Set();
  const lower = modelName.toLowerCase().trim();
  out.add(lower);

  // Without the brand prefix: "voyah passion l" -> "passion l".
  const noBrand = lower.replace(/^(voyah|mhero|m-hero|m hero)\s+/, "").trim();
  if (noBrand && noBrand !== lower && !COMMON_ENGLISH.has(noBrand)) {
    out.add(noBrand);
  }

  // Spacing variants of the MHERO brand, which people write every way.
  if (/^mhero/.test(lower)) {
    out.add(lower.replace(/^mhero/, "m hero"));
    out.add(lower.replace(/^mhero/, "m-hero"));
    // Roman numerals, as the catalogue PDFs name them.
    if (/\b1\b/.test(lower)) out.add(lower.replace(/\b1\b/, "i"));
    if (/\b2\b/.test(lower)) out.add(lower.replace(/\b2\b/, "ii"));
  }

  return [...out].filter((a) => a.length >= 3);
}

async function listDirs(dir) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !isJunk(e.name))
    .map((e) => e.name)
    .sort();
}

async function listFiles(dir, extensions) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (!e.isFile() || isJunk(e.name)) continue;
    if (!extensions.has(path.extname(e.name).toLowerCase())) continue;
    const full = path.join(dir, e.name);
    const info = await stat(full);
    out.push({ fileName: e.name, bytes: info.size, absolutePath: full });
  }
  return out.sort((a, b) => a.fileName.localeCompare(b.fileName));
}

async function importFolder(root) {
  const carModelsDir = path.join(root, "Car Models");
  const base = existsSync(carModelsDir) ? carModelsDir : root;

  const modelNames = await listDirs(base);
  const cars = [];
  const warnings = [];

  for (const modelName of modelNames) {
    const modelDir = path.join(base, modelName);
    const catalogDir = path.join(modelDir, "Catalog");
    const videosDir = path.join(modelDir, "Videos");

    /* ── the one catalogue ─────────────────────────────────────────────── */
    const pdfs = await listFiles(catalogDir, DOC_EXTENSIONS);
    if (pdfs.length === 0) {
      warnings.push(`${modelName}: no catalogue PDF — it can never auto-send.`);
    } else if (pdfs.length > 1) {
      warnings.push(
        `${modelName}: ${pdfs.length} PDFs in Catalog; using "${pdfs[0].fileName}".`
      );
    }
    const brochure = pdfs[0] ?? null;

    /* ── colours ───────────────────────────────────────────────────────── */
    const colourDirs = await listDirs(videosDir);
    const colours = [];

    // Voyah Dream's case: videos directly under Videos/, no colour folders.
    // That car has no colour choice, and saying so is better than inventing
    // one — the flow sends it without asking.
    const loose = await listFiles(videosDir, VIDEO_EXTENSIONS);
    if (colourDirs.length === 0 && loose.length > 0) {
      colours.push({
        id: "standard",
        name: "Standard",
        aliases: [],
        videos: loose.map(({ fileName, bytes }) => ({ fileName, bytes })),
        noColourChoice: true,
      });
      warnings.push(
        `${modelName}: videos are not in colour folders — treated as one option with no colour choice.`
      );
    } else if (loose.length > 0) {
      warnings.push(
        `${modelName}: ${loose.length} video(s) sit outside a colour folder and were skipped.`
      );
    }

    for (const colourName of colourDirs) {
      const videos = await listFiles(path.join(videosDir, colourName), VIDEO_EXTENSIONS);
      if (videos.length === 0) {
        // A real case: Mhero 1 / Black. The colour is recorded so the gap is
        // visible on the dashboard, and marked unsendable so it is never
        // offered to a customer.
        warnings.push(`${modelName} / ${colourName}: folder is empty — cannot be offered.`);
      }
      colours.push({
        id: slug(colourName),
        name: colourName,
        aliases: [colourName.toLowerCase()],
        videos: videos.map(({ fileName, bytes }) => ({ fileName, bytes })),
      });
    }

    for (const c of colours) {
      for (const v of c.videos) {
        if (v.bytes > MAX_FILE_BYTES) {
          warnings.push(
            `${modelName} / ${c.name} / ${v.fileName}: ` +
              `${(v.bytes / 1024 / 1024).toFixed(1)} MB is over the 50 MB limit — compress before uploading.`
          );
        }
      }
    }

    const sendable = colours.filter((c) => c.videos.length > 0);
    cars.push({
      id: slug(modelName),
      name: modelName,
      folder: modelName,
      aliases: aliasesFor(modelName),
      brochure: brochure ? { fileName: brochure.fileName, bytes: brochure.bytes } : null,
      colours,
      // What the flow needs to know at a glance.
      readyToSend: Boolean(brochure) && sendable.length > 0,
    });
  }

  return { root, cars, warnings };
}

/* ── report ──────────────────────────────────────────────────────────────── */

function mb(bytes) {
  return (bytes / 1024 / 1024).toFixed(1);
}

function report(result) {
  const lines = [];
  let totalBytes = 0;
  let totalVideos = 0;

  lines.push(`Sales folder: ${result.root}`);
  lines.push("");

  for (const car of result.cars) {
    const sendable = car.colours.filter((c) => c.videos.length > 0);
    const flag = car.readyToSend ? "READY" : "NOT READY";
    lines.push(`${car.name}  [${flag}]`);
    lines.push(
      `  catalogue: ${car.brochure ? `${car.brochure.fileName} (${mb(car.brochure.bytes)} MB)` : "MISSING"}`
    );
    if (car.colours.length === 0) {
      lines.push("  colours:   none found");
    }
    for (const colour of car.colours) {
      const bytes = colour.videos.reduce((n, v) => n + v.bytes, 0);
      totalBytes += bytes;
      totalVideos += colour.videos.length;
      const state =
        colour.videos.length === 0
          ? "EMPTY — will not be offered"
          : `${colour.videos.length} video(s), ${mb(bytes)} MB`;
      lines.push(`  ${colour.name.padEnd(10)} ${state}`);
    }
    if (car.brochure) totalBytes += car.brochure.bytes;
    lines.push(`  aliases:   ${car.aliases.join(", ")}`);
    lines.push("");
  }

  lines.push(
    `${result.cars.length} models · ${totalVideos} videos · ${mb(totalBytes)} MB total`
  );

  if (result.warnings.length > 0) {
    lines.push("");
    lines.push("NEEDS YOUR ATTENTION");
    for (const w of result.warnings) lines.push(`  - ${w}`);
  }

  return lines.join("\n");
}

/* ── emitting the module the app reads ───────────────────────────────────── */

const DEFAULT_OUT = "lib/wasales/sales-manifest.ts";

/**
 * Render the manifest as a TypeScript module.
 *
 * TypeScript rather than JSON because a JSON import needs an import attribute
 * that Node's test runner and the bundler disagree about, and this file is read
 * by both. The type declarations stay in the checked-in module so a hand edit
 * that breaks the shape fails the typecheck rather than the sales flow.
 */
function renderModule(manifest) {
  const body = JSON.stringify(manifest, null, 2);
  return `/**
 * The imported sales material — GENERATED, do not edit by hand.
 *
 * Written by:
 *   node scripts/import-sales-folder.mjs "<path to Monza AI sales>" --write
 *
 * The application never invents a model or a colour: everything below is the
 * folder's own directory and file names.
 */

export interface ManifestFile {
  fileName: string;
  bytes: number;
}

export interface ManifestColour {
  id: string;
  name: string;
  aliases?: string[];
  videos: ManifestFile[];
  /** True for a car whose videos sit outside any colour folder. */
  noColourChoice?: boolean;
}

export interface ManifestCar {
  id: string;
  name: string;
  folder: string;
  aliases: string[];
  brochure: ManifestFile | null;
  colours: ManifestColour[];
  readyToSend: boolean;
}

export interface SalesManifest {
  importedFrom: string | null;
  cars: ManifestCar[];
  warnings: string[];
}

export const SALES_MANIFEST: SalesManifest = ${body};
`;
}

/* ── main ────────────────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith("--"));
const outIndex = args.indexOf("--out");
const explicitOut = outIndex >= 0 ? args[outIndex + 1] : null;
const outPath = explicitOut ?? (args.includes("--write") ? DEFAULT_OUT : null);

if (!root) {
  console.error(
    'Usage: node scripts/import-sales-folder.mjs "<path to Monza AI sales>" [--write]'
  );
  process.exit(1);
}
if (!existsSync(root)) {
  console.error(`That folder does not exist:\n  ${root}`);
  process.exit(1);
}

const result = await importFolder(root);
console.log(report(result));

if (outPath) {
  // The manifest deliberately carries NO absolute paths — it is committed to
  // the repository and describes WHAT exists, not where one person keeps it.
  const manifest = {
    importedFrom: path.basename(result.root),
    cars: result.cars,
    warnings: result.warnings,
  };
  await writeFile(outPath, renderModule(manifest), "utf8");
  console.log(`\nWrote ${outPath}`);
  console.log("Now run: npm test && npm run build");
}
