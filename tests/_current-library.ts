/**
 * THE LIVE SALES LIBRARY AS IT IS NOW — listed from the Supabase bucket `wasales-media` on
 * 2026-09-18, AFTER Samer re-filed every colour under its official name (pearl-black, storm-grey…).
 * `_live-library.ts` is the listing from earlier the same day (colour ids "black", "grey"…), kept for
 * the tests that are about that re-filing. Tests that speak about what a customer RECEIVES TODAY use
 * this one, built exactly as production builds it (suggestion-server `withLibraryColours`).
 *
 * What it shows, and the tests rely on:
 *   - Courage Pearl White is 40.6 MB with NO small copy: over WhatsApp's 16 MB, it can only go as a link.
 *   - Orphan send copies (mhero-2 black/green/white, courage grey, dream standard): ignored, never sent.
 *   - No Recon Green (MHERO 1) and no Polar Silver video: those colours are not offered.
 *   - No brochure-send copies: the Courage (31 MB), Passion (72 MB) and MHERO 1 (34 MB) brochures are
 *     over Instagram's / Messenger's 25 MB and go as links there; WhatsApp takes them (100 MB).
 *
 * Refresh: select name, (metadata->>'size')::bigint from storage.objects where bucket_id = 'wasales-media' order by name;
 */
import { libraryColour, libraryMedia, loadCatalog, type LibraryFile } from "@/lib/wasales/catalog";
import { colourNameFrom } from "@/lib/wasales/media-paths";

const RAW = `mhero-1/brochure/M-Hero-I.pdf 33721887
mhero-1/video/obsidian-black/Obsidian-Black.mp4 12249550
mhero-1/video/storm-grey/Storm-Grey.mp4 3320273
mhero-2/brochure/M-Hero-II.pdf 7654327
mhero-2/video-send/black/old.mp4 3213785
mhero-2/video-send/green/old.mp4 1603375
mhero-2/video-send/white/old.mp4 4102396
mhero-2/video/clouds-white/Clouds-White.mp4 5818082
mhero-2/video/olive-green/Olive-Green.mp4 2147172
mhero-2/video/piano-black/Piano-Black.mp4 4844545
voyah-courage/brochure/Voyah-courage.pdf 31465661
voyah-courage/video-send/grey/old.mp4 2781501
voyah-courage/video/crayon-grey/Crayon-Grey.mp4 4000188
voyah-courage/video/pearl-black/Pearl-Black.mp4 3331350
voyah-courage/video/pearl-white/Pearl-White.mp4 40600020
voyah-dream/brochure/Voyah-dream.pdf 21409076
voyah-dream/video-send/standard/old.mp4 4525837
voyah-dream/video/midnight-black/Midnight-Black.mp4 9229884
voyah-free-comp/brochure/Voyah-free.pdf 21090188
voyah-free-comp/video-send/british-racing-green/c.mp4 5141280
voyah-free-comp/video-send/midnight-black/c.mp4 4453376
voyah-free-comp/video-send/pearl-white/c.mp4 3427146
voyah-free-comp/video-send/sage-green/c.mp4 1443332
voyah-free-comp/video-send/titanium-grey/c.mp4 2787330
voyah-free-comp/video/british-racing-green/o.mp4 65687995
voyah-free-comp/video/midnight-black/o.mp4 7720103
voyah-free-comp/video/pearl-white/o.mp4 4915937
voyah-free-comp/video/sage-green/o.mov 28222397
voyah-free-comp/video/titanium-grey/o.mp4 7254907
voyah-passion-l/brochure/PassionL.pdf 1765326
voyah-passion-l/video-send/obsidian-black/c.mp4 2448189
voyah-passion-l/video-send/titanium-grey/c.mp4 2087652
voyah-passion-l/video/obsidian-black/o.mp4 3716029
voyah-passion-l/video/titanium-grey/o.mp4 3280129
voyah-passion/brochure/Passion.pdf 71628445
voyah-passion/video-send/midnight-black/c.mp4 1617478
voyah-passion/video/midnight-black/o.mp4 5114177
voyah-taishan/brochure/Taishan.pdf 3238263
voyah-taishan/video-send/obsidian-black/c.mp4 2333526
voyah-taishan/video-send/sapphire-blue/c.mp4 2399707
voyah-taishan/video-send/storm-grey/c.mp4 5836781
voyah-taishan/video/obsidian-black/o.mov 50749376
voyah-taishan/video/sapphire-blue/o.mov 50164721
voyah-taishan/video/storm-grey/o.mp4 9169160`;

export const FILES: LibraryFile[] = RAW.split("\n").map((line) => {
  const [p, size] = line.split(" ");
  const seg = p.split("/");
  const sendCopy = seg[1].endsWith("-send");
  const kind = seg[1].startsWith("brochure") ? "brochure" : "video";
  return { carId: seg[0], kind, colourId: kind === "video" ? seg[2] : null, name: seg[seg.length - 1], size: Number(size), url: `https://lib.example/${p}`, ...(sendCopy ? { sendCopy: true } : {}) } as LibraryFile;
});

export const media = libraryMedia(FILES);
// Exactly what suggestion-server does: the catalogue plus colours that exist only in the library.
export const catalog = loadCatalog().map((car) => {
  const extra = [...new Set(FILES.filter((f) => f.carId === car.id && f.kind === "video" && f.colourId).map((f) => f.colourId as string))].filter((id) => !car.colours.some((c) => c.id === id));
  return extra.length === 0 ? car : { ...car, colours: [...car.colours, ...extra.map((id) => libraryColour(id, colourNameFrom(id)))] };
});
