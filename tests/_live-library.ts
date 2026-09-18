/**
 * What the LIVE shared sales library held on 2026-09-18 (Supabase bucket
 * `wasales-media`, listed that day): car / kind / colour and size, with the
 * file names shortened. The bot in production reads the live library
 * (`libraryMedia`), NOT the sales folder imported on 2026-09-04
 * (`folderMedia`) — and the two differ: the folder had no MHERO 1 Black and
 * no Passion video, the library has both. Tests that speak about what a
 * customer RECEIVES use this snapshot, so they describe production.
 *
 * Refresh it when videos are uploaded:
 *   select name, (metadata->>'size')::bigint from storage.objects where bucket_id = 'wasales-media' order by name;
 */

import { libraryMedia, type LibraryFile } from "@/lib/wasales/catalog";

export const LIVE_LIBRARY_2026_09_18: readonly LibraryFile[] = [
  { carId: "mhero-1", kind: "brochure", colourId: null, name: "M-Hero-I-2026-catalogue.pdf", size: 33721887 },
  { carId: "mhero-1", kind: "video", colourId: "black", name: "WhatsApp-Video-2026-09-04-at-1.58.20-PM.mp4", size: 3919375, sendCopy: true },
  { carId: "mhero-1", kind: "video", colourId: "grey", name: "A-Bold-approach-The-M-Hero-I.mp4", size: 2229594, sendCopy: true },
  { carId: "mhero-1", kind: "video", colourId: "black", name: "WhatsApp-Video-2026-09-04-at-1.58.20-PM.mp4", size: 12249550 },
  { carId: "mhero-1", kind: "video", colourId: "grey", name: "A-Bold-approach-The-M-Hero-I.mp4", size: 3320273 },
  { carId: "mhero-2", kind: "brochure", colourId: null, name: "M-Hero-II-2026-catalogue.pdf", size: 7654327 },
  { carId: "mhero-2", kind: "video", colourId: "black", name: "Traditionally-configured-for-your-adventures-ahead.mp4", size: 3213785, sendCopy: true },
  { carId: "mhero-2", kind: "video", colourId: "green", name: "Welcoming-a-new-model-into-our-family.mp4", size: 1603375, sendCopy: true },
  { carId: "mhero-2", kind: "video", colourId: "white", name: "Not-for-everyone-And-that-s-the-point.mp4", size: 4102396, sendCopy: true },
  { carId: "mhero-2", kind: "video", colourId: "black", name: "Traditionally-configured-for-your-adventures-ahead.mp4", size: 4844545 },
  { carId: "mhero-2", kind: "video", colourId: "green", name: "Welcoming-a-new-model-into-our-family.mp4", size: 2147172 },
  { carId: "mhero-2", kind: "video", colourId: "white", name: "Not-for-everyone-And-that-s-the-point.mp4", size: 5818082 },
  { carId: "voyah-courage", kind: "brochure", colourId: null, name: "Voyah-courage-2026-catalogue.pdf", size: 31465661 },
  { carId: "voyah-courage", kind: "video", colourId: "black", name: "All-Black-Voyah-Courage.mp4", size: 2382421, sendCopy: true },
  { carId: "voyah-courage", kind: "video", colourId: "grey", name: "Voyah-Courage-in-Crayon-Grey.mp4", size: 2781501, sendCopy: true },
  { carId: "voyah-courage", kind: "video", colourId: "white", name: "Courage-White.mp4", size: 5311886, sendCopy: true },
  { carId: "voyah-courage", kind: "video", colourId: "black", name: "All-Black-Voyah-Courage.mp4", size: 3331350 },
  { carId: "voyah-courage", kind: "video", colourId: "grey", name: "Voyah-Courage-in-Crayon-Grey.mp4", size: 4000188 },
  { carId: "voyah-courage", kind: "video", colourId: "white", name: "Courage-White.mov", size: 121160738 },
  { carId: "voyah-dream", kind: "brochure", colourId: null, name: "Voyah-dream-2026-catalogue.pdf", size: 21409076 },
  { carId: "voyah-dream", kind: "video", colourId: "standard", name: "When-the-voyah-dream-makes-an-appearance.mp4", size: 4525837, sendCopy: true },
  { carId: "voyah-dream", kind: "video", colourId: "standard", name: "When-the-voyah-dream-makes-an-appearance.mp4", size: 7995542 },
  { carId: "voyah-free-comp", kind: "brochure", colourId: null, name: "Voyah-free-Competition-2026-catalogue.pdf", size: 21090188 },
  { carId: "voyah-free-comp", kind: "video", colourId: "black", name: "Dark-on-the-outside-Light-within.mp4", size: 4453376, sendCopy: true },
  { carId: "voyah-free-comp", kind: "video", colourId: "green", name: "VOYAH-FREE---COMPETITION.mp4", size: 5141280, sendCopy: true },
  { carId: "voyah-free-comp", kind: "video", colourId: "grey", name: "Voyah-Free-Grey.mp4", size: 2787330, sendCopy: true },
  { carId: "voyah-free-comp", kind: "video", colourId: "sage", name: "copy_8CBB8FE5.mp4", size: 1443332, sendCopy: true },
  { carId: "voyah-free-comp", kind: "video", colourId: "white", name: "Pearl-white-elegance.mp4", size: 3427146, sendCopy: true },
  { carId: "voyah-free-comp", kind: "video", colourId: "black", name: "Dark-on-the-outside-Light-within.mp4", size: 7720103 },
  { carId: "voyah-free-comp", kind: "video", colourId: "green", name: "VOYAH-FREE---COMPETITION.mp4", size: 65687995 },
  { carId: "voyah-free-comp", kind: "video", colourId: "grey", name: "Voyah-Free-Grey.mp4", size: 7254907 },
  { carId: "voyah-free-comp", kind: "video", colourId: "sage", name: "copy_8CBB8FE5.mov", size: 28222397 },
  { carId: "voyah-free-comp", kind: "video", colourId: "white", name: "Pearl-white-elegance.mp4", size: 4915937 },
  { carId: "voyah-passion-l", kind: "brochure", colourId: null, name: "VOYAH-PASSION-L-Catalogue-2026.pdf", size: 1765326 },
  { carId: "voyah-passion-l", kind: "video", colourId: "black", name: "The-all-new-Voyah-Passion-L-in-Black.mp4", size: 2448189, sendCopy: true },
  { carId: "voyah-passion-l", kind: "video", colourId: "grey", name: "Voyah-Passion-L-in-Titanium-Grey.mp4", size: 2087652, sendCopy: true },
  { carId: "voyah-passion-l", kind: "video", colourId: "black", name: "The-all-new-Voyah-Passion-L-in-Black.mp4", size: 3716029 },
  { carId: "voyah-passion-l", kind: "video", colourId: "grey", name: "Voyah-Passion-L-in-Titanium-Grey.mp4", size: 3280129 },
  { carId: "voyah-passion", kind: "brochure", colourId: null, name: "Voyah-passion-2026-catalogue.pdf", size: 71628445 },
  { carId: "voyah-passion", kind: "video", colourId: "black", name: "WhatsApp-Video-2026-09-04-at-10.26.28-AM.mp4", size: 1617478, sendCopy: true },
  { carId: "voyah-passion", kind: "video", colourId: "black", name: "WhatsApp-Video-2026-09-04-at-10.26.28-AM.mp4", size: 5114177 },
  { carId: "voyah-taishan", kind: "brochure", colourId: null, name: "VOYAH-TAISHAN-Catalogue-2026.pdf", size: 3238263 },
  { carId: "voyah-taishan", kind: "video", colourId: "black", name: "copy_C81B4DD7.mp4", size: 2333526, sendCopy: true },
  { carId: "voyah-taishan", kind: "video", colourId: "blue", name: "copy_F7D2E670.mp4", size: 2399707, sendCopy: true },
  { carId: "voyah-taishan", kind: "video", colourId: "grey", name: "The-VOYAH-Taishan-flagship.mp4", size: 5836781, sendCopy: true },
  { carId: "voyah-taishan", kind: "video", colourId: "black", name: "copy_C81B4DD7.mov", size: 50749376 },
  { carId: "voyah-taishan", kind: "video", colourId: "blue", name: "copy_F7D2E670.mov", size: 50164721 },
  { carId: "voyah-taishan", kind: "video", colourId: "grey", name: "The-VOYAH-Taishan-flagship.mp4", size: 9169160 },
];

/** The media lookup production uses, over that snapshot. */
export const liveMedia = libraryMedia(LIVE_LIBRARY_2026_09_18);
