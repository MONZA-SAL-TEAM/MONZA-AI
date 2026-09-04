/**
 * GET /api/whatsapp-sales — the catalogue the Sales screen renders.
 *
 * The catalogue is Monza's own MATERIAL, not customer data, so it is served
 * whether or not a CRM is connected: the models, their colours and their file
 * names all come from lib/wasales/sales-manifest.ts, which the sales folder
 * import writes. Before that import the seed catalogue is served instead —
 * model names and aliases only, with no colours and no media — and
 * `imported: false` says so, because an empty colour list means "nobody has
 * told us yet", not "this car has no colours".
 *
 * WHAT THIS ROUTE DOES NOT DO is claim anything is sendable. The folder
 * listing describes files on somebody's disk; the shared bucket is a separate
 * place, and until a file is uploaded there it cannot reach a customer. The
 * screen keeps those two apart and so does this shape: `colours[].videos` is
 * the FOLDER, and what has actually been uploaded is read separately by the
 * browser from the media store.
 *
 * Auth mirrors the other board routes: requireStaff returns the fixed demo
 * identity when no CRM is configured (the page works with zero credentials),
 * and fails closed — 401 — when a CRM is configured and no valid token came.
 */

import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import {
  catalogueImported,
  catalogueSource,
  catalogueWarnings,
  loadCatalog,
  mediaIndexFor,
} from "@/lib/wasales/catalog";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const user = await requireStaff(request);
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }

  const cars = loadCatalog();

  return NextResponse.json({
    /** True once the real sales folder has been imported. */
    imported: catalogueImported(),
    /** Where it came from, in words the screen can print. */
    source: catalogueSource(),
    /**
     * Everything the import flagged for a person: an empty colour folder, a
     * file over the bucket's limit, the same video filed under two models.
     * Shown on the screen rather than buried in a terminal, because the
     * person who can fix them is the one looking at this page.
     */
    warnings: catalogueWarnings(),
    catalog: cars,
    /**
     * How many videos each colour has IN THE FOLDER, per car. The screen
     * needs this to show which colours could be offered once the files are
     * uploaded, without pretending they already are.
     */
    folderVideoCounts: Object.fromEntries(
      cars.map((car) => [car.id, mediaIndexFor(car)])
    ),
  });
}
