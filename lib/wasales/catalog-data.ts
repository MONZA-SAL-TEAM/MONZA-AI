/**
 * WhatsApp Sales — the seed catalog the control page starts from.
 *
 * Names, aliases and one-liners are the real Monza lineup. Media is NEVER
 * seeded: every car starts with no videos, no brochure AND NO COLOURS, and the
 * only files the page ever shows are REAL uploads from the media store
 * (lib/wasales/media-store.ts). A car with nothing uploaded shows an honest
 * empty state and never auto-sends.
 *
 * COLOURS ARE NOT INVENTED HERE. Which colours a model comes in is a fact
 * about Monza's actual material, so the list is discovered when the sales
 * folder is imported (scripts/scan-sales-folder.mjs) and never guessed. Until
 * then every car has an empty colour list and the flow says so plainly rather
 * than offering a colour nobody has a video of.
 *
 * Alias policy (feeds the matcher directly):
 *   - model-only words ("free", "dream", "passion", "courage", "917") so a
 *     customer never has to type "Voyah";
 *   - common misspellings ("pasion", "pashion", "dreem", "curage", "mhiro")
 *     as EXACT aliases, on top of the matcher's own edit-distance tolerance;
 *   - variant models list their variant phrase ("passion l", "pasion l") and
 *     NEVER the bare base word — the matcher's most-specific-wins rule needs
 *     the Passion L to claim only messages that show the L.
 */

import type { WaCar, WaSource } from "@/lib/wasales/matcher";

export const WASALES_CATALOG: WaCar[] = [
  {
    id: "voyah-free",
    name: "Voyah Free",
    enabled: true,
    // Deliberately NO bare "free" alias: ordinary English ("feel free to
    // call", "free delivery?") would auto-send a car. The article form and
    // brand forms cover how people actually ask for this model.
    aliases: ["voyah free", "the free", "voya free", "voyah fri", "free suv"],
    videos: [],
    colours: [],
    brochure: null,
    oneLiner: "Mid-size electric SUV — the range-anxiety killer.",
  },
  {
    id: "voyah-dream",
    name: "Voyah Dream",
    enabled: true,
    aliases: ["dream", "dreem", "drim", "voyah dream", "voya dream"],
    videos: [],
    colours: [],
    brochure: null,
    oneLiner: "Luxury electric MPV — the family flagship.",
  },
  {
    id: "voyah-passion",
    name: "Voyah Passion",
    enabled: true,
    aliases: ["passion", "pasion", "pashion", "passon", "voyah passion"],
    videos: [],
    colours: [],
    brochure: null,
    oneLiner: "Electric executive sedan — quiet, quick, composed.",
  },
  {
    id: "voyah-passion-l",
    name: "Voyah Passion L",
    enabled: true,
    // Variant phrases ONLY — never the bare word "passion" (see header note).
    aliases: ["passion l", "pasion l", "pashion l", "passion el", "passionl"],
    videos: [],
    colours: [],
    brochure: null,
    oneLiner: "Long-wheelbase Passion — the chauffeured option.",
  },
  {
    id: "voyah-courage",
    name: "Voyah Courage",
    enabled: true,
    aliases: ["courage", "curage", "corage", "courge", "voyah courage"],
    videos: [],
    colours: [],
    brochure: null,
    oneLiner: "Compact electric SUV — the accessible entry to Voyah.",
  },
  {
    id: "mhero-917",
    name: "MHERO 917",
    enabled: true,
    aliases: ["917", "mhero", "m hero", "mhero 917", "m hero 917", "mhiro"],
    videos: [],
    colours: [],
    brochure: null,
    oneLiner: "Military-derived electric off-roader — the statement piece.",
  },
];

/* ------------------------------------------------- simulator quick-tries --- */

export interface SampleMessage {
  /** Chip label on the simulator. */
  label: string;
  text: string;
  isNewNumber: boolean;
  isFirstMessage: boolean;
  source: WaSource;
}

/**
 * One chip per rule worth proving: the typo that must still land, a website
 * click-to-WhatsApp prefill, a two-car comparison (hold), a bare greeting
 * (hold), and a returning number (hold even with a clear car).
 */
export const SAMPLE_MESSAGES: SampleMessage[] = [
  {
    label: "Typo: “pasion l”",
    text: "hi can i get more informations about the pasion l",
    isNewNumber: true,
    isFirstMessage: true,
    source: "facebook",
  },
  {
    label: "Website prefill",
    text: "More information about the Voyah Free please",
    isNewNumber: true,
    isFirstMessage: true,
    source: "website",
  },
  {
    label: "MHERO, misspelled",
    text: "how much is the m hiro 917",
    isNewNumber: true,
    isFirstMessage: true,
    source: "instagram",
  },
  {
    label: "Two cars at once",
    text: "which is better the dream or the passion?",
    isNewNumber: true,
    isFirstMessage: true,
    source: "instagram",
  },
  {
    label: "Just “hi”",
    text: "hi",
    isNewNumber: true,
    isFirstMessage: true,
    source: "facebook",
  },
  {
    label: "Returning number",
    text: "ok and the passion l in white?",
    isNewNumber: false,
    isFirstMessage: false,
    source: "direct",
  },
];
