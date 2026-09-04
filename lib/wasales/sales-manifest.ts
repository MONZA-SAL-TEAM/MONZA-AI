/**
 * The imported sales material — GENERATED, do not edit by hand.
 *
 * Written by:
 *   node scripts/import-sales-folder.mjs "<path to Monza AI sales>" --out lib/wasales/sales-manifest.ts
 *
 * Until that has been run this file is empty, every car has no colours, and the
 * sales flow says plainly that nothing can be sent yet. The application never
 * invents a model or a colour: they are the folder's own directory names.
 *
 * A TypeScript module rather than JSON on purpose — a JSON import needs an
 * import attribute that Node's test runner and the bundler disagree about, and
 * this file is read by both.
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

export const SALES_MANIFEST: SalesManifest = {
  importedFrom: null,
  cars: [],
  warnings: [],
};
