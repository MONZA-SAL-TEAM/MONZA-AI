/**
 * The shared sales library, listed on the SERVER — what the inbox's sales
 * suggestions may offer. The browser store (media-store.ts) lists the same
 * bucket for the /sales page; this is its server twin, for the suggestion
 * routes, using the service key through lib/channels/store.ts.
 *
 * Paths, as media-paths.ts defines them:
 *   <carId>/brochure/<file>
 *   <carId>/brochure-send/<file>           a brochure shrunk under 25 MB,
 *                                          preferred by libraryMedia()
 *   <carId>/video/<colourId>/<file>
 *   <carId>/video-send/<colourId>/<file>   small copies made for sending
 *                                          (scripts/sales-video-prep.mjs),
 *                                          preferred by libraryMedia()
 *
 * The bucket is public-read by design (app/api/wasales-media/route.ts), so each
 * file's public address is what a channel fetches when a person sends it.
 * Cached for five minutes: a new upload shows in suggestions within that.
 */

import { channelDb } from "@/lib/channels/store";
import { MEDIA_BUCKET, displayNameOf } from "@/lib/wasales/media-paths";
import type { LibraryFile } from "@/lib/wasales/catalog";

const CACHE_MS = 5 * 60_000;
const FOLDER = /^[A-Za-z0-9_-]{1,64}$/;

let cached: { at: number; key: string; files: LibraryFile[] } | null = null;

interface Entry {
  name?: unknown;
  id?: unknown;
  metadata?: unknown;
}

function isFolder(e: Entry): boolean {
  return e.id === null || e.id === undefined;
}

function nameOf(e: Entry): string {
  return typeof e.name === "string" ? e.name : "";
}

function sizeOf(e: Entry): number {
  const meta = e.metadata && typeof e.metadata === "object" ? (e.metadata as Record<string, unknown>) : {};
  return typeof meta.size === "number" ? meta.size : 0;
}

export type LibraryListing = { ok: true; files: LibraryFile[] } | { ok: false; problem: string };

/** Every brochure and colour video of these cars in the shared library. */
export async function listLibraryFiles(
  carIds: readonly string[],
  nowMs: number = Date.now()
): Promise<LibraryListing> {
  const key = [...carIds].sort().join(",");
  if (cached && cached.key === key && nowMs - cached.at < CACHE_MS) {
    return { ok: true, files: cached.files };
  }
  const sb = channelDb();
  if (!sb) return { ok: false, problem: "The file store is not configured on this server." };
  const bucket = sb.storage.from(MEDIA_BUCKET);

  const list = async (prefix: string): Promise<Entry[]> => {
    const { data, error } = await bucket.list(prefix, {
      limit: 200,
      sortBy: { column: "created_at", order: "asc" },
    });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? (data as Entry[]) : [];
  };
  const filesIn = (entries: Entry[]) =>
    entries.filter((e) => !isFolder(e) && nameOf(e) !== "" && !nameOf(e).startsWith("."));
  const foldersIn = (entries: Entry[]) =>
    entries.filter((e) => isFolder(e) && FOLDER.test(nameOf(e))).map(nameOf);
  const publicUrl = (path: string) => bucket.getPublicUrl(path).data.publicUrl;

  try {
    const perCar = await Promise.all(
      carIds.filter((id) => FOLDER.test(id)).map(async (carId) => {
        const out: LibraryFile[] = [];
        for (const [folder, sendCopy] of [
          ["brochure", false],
          ["brochure-send", true],
        ] as const) {
          for (const e of filesIn(await list(`${carId}/${folder}`))) {
            const path = `${carId}/${folder}/${nameOf(e)}`;
            out.push({
              carId,
              kind: "brochure",
              colourId: null,
              name: displayNameOf(nameOf(e)),
              size: sizeOf(e),
              url: publicUrl(path),
              ...(sendCopy ? { sendCopy: true } : {}),
            });
          }
        }
        for (const [folder, sendCopy] of [
          ["video", false],
          ["video-send", true],
        ] as const) {
          for (const colourId of foldersIn(await list(`${carId}/${folder}`))) {
            for (const e of filesIn(await list(`${carId}/${folder}/${colourId}`))) {
              const path = `${carId}/${folder}/${colourId}/${nameOf(e)}`;
              out.push({
                carId,
                kind: "video",
                colourId,
                name: displayNameOf(nameOf(e)),
                size: sizeOf(e),
                url: publicUrl(path),
                ...(sendCopy ? { sendCopy: true } : {}),
                ...(/interior|inside|cabin|dashboard/i.test(nameOf(e)) ? { view: "interior" as const } : {}),
              });
            }
          }
        }
        return out;
      })
    );
    const files = perCar.flat();
    cached = { at: nowMs, key, files };
    return { ok: true, files };
  } catch {
    return { ok: false, problem: "Could not list the sales library just now." };
  }
}
