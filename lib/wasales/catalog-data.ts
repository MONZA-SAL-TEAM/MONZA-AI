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

import type { WaCar } from "@/lib/wasales/matcher";

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

/* ---------------------------------------------- how customers really ask --- */

/**
 * How customers actually ask for each model, on top of the aliases the folder
 * import generates from the model names. Keyed by the IMPORTED car id and
 * merged in by lib/wasales/catalog.ts, so a re-import never loses them.
 *
 * "free" is here on purpose (Samer, 2026-09-12: customers say "free",
 * "courage", "dream", "passion", "mhero 1", "mhero 2"). It is safe as a bare
 * word only because the matcher blanks everyday phrases such as "feel free"
 * and "for free" before matching — NOT_A_CAR_PHRASES in matcher.ts. The seed
 * above predates that guard, which is why it still avoids a bare "free".
 *
 * 917 is the MHERO 1 and 817 the MHERO 2, the names they are sold under
 * abroad; the Mhero 2 folder's own video is tagged #mhero817. Digits are never
 * fuzzy-matched, so 911 cannot land on either.
 */
export const CUSTOMER_WORDS: Readonly<Record<string, readonly string[]>> = {
  "mhero-1": ["917", "mhero 917", "m hero 917", "mhero one", "m hero one", "ام هيرو 1"],
  "mhero-2": ["817", "mhero 817", "m hero 817", "mhero two", "m hero two", "ام هيرو 2"],
  "voyah-courage": ["curage", "corage", "courge", "currage", "كوراج", "كوريج"],
  "voyah-dream": ["dreem", "drim", "دريم"],
  // The FREE 318: its folder is "Voyah Free Comp", its video caption says
  // "The new Voyah Free 318 Competition", so "318" is its own word.
  "voyah-free-comp": [
    "free",
    "the free",
    "voyah free",
    "free 318",
    "voyah free 318",
    "318",
    "free competition",
    "فري",
    "فوياه فري",
  ],
  "voyah-passion": ["pasion", "pashion", "passon", "باشن", "باشون"],
  // Never the bare Arabic "باشن": most-specific-wins needs the L to be seen.
  "voyah-passion-l": ["pasion l", "pashion l", "passion el", "passionl", "باشن l"],
  "voyah-taishan": ["tai shan", "taichan", "تايشان", "تاي شان"],
};

/**
 * How customers name each COLOUR, keyed by the colour's folder id and merged
 * into every car's colours by lib/wasales/catalog.ts. English, French,
 * Arabizi and Arabic as normalize() writes them (hamza and taa marbuta are
 * folded there, so "أسود" and "اسود" are the same word).
 *
 * "sage green" sits under sage so that, on the one car with both, it is the
 * longer phrase and wins over plain "green".
 */
export const COLOUR_WORDS: Readonly<Record<string, readonly string[]>> = {
  black: ["noir", "aswad", "sawda", "اسود", "سودا"],
  white: ["blanc", "abyad", "bayda", "ابيض", "بيضا", "pearl white"],
  grey: ["gray", "gris", "rmadi", "رمادي", "رصاصي", "crayon grey", "titanium grey"],
  green: ["vert", "akhdar", "khadra", "اخضر", "خضرا"],
  blue: ["bleu", "azrak", "azra2", "ازرق", "زرقا"],
  sage: ["sage green"],
};

/* ------------------------------------------------- simulator quick-tries --- */

export interface SampleMessage {
  /** Chip label on the simulator. */
  label: string;
  text: string;
  /** A tapped button's payload, when the sample is a tap rather than words. */
  payload?: string;
}

/**
 * The opening patterns the first-message study found (2026-09-14, 482 real
 * conversations), paraphrased — no customer's words are kept here. Most
 * frequent first: the Instagram ad button's "Can I know more info?" (157), a
 * bare hello, price (89), then the long tail. Each chip starts a fresh
 * conversation on the account selected in the simulator.
 */
export const SAMPLE_MESSAGES: SampleMessage[] = [
  { label: "Ad button: “more info”", text: "Can I know more info?" },
  { label: "Just “hi”", text: "hi" },
  { label: "“price?”", text: "price?" },
  { label: "“hp?”", text: "hp?" },
  { label: "Names the car", text: "is the free available?" },
  { label: "Typo: “pasion l”", text: "hi can i get more informations about the pasion l" },
  { label: "Colour up front", text: "info about the black courage please" },
  { label: "Brand only", text: "info about the mhero please" },
  { label: "Two cars", text: "which is better the dream or the passion?" },
  { label: "Where are you?", text: "where is your showroom?" },
  { label: "Installments", text: "do you have installments?" },
  { label: "Test drive", text: "can I book a test drive for the taishan" },
  { label: "Arabic", text: "مرحبا، شو سعر الكوراج؟" },
  { label: "Arabizi", text: "kifak, ade se3er el taishan?" },
  { label: "Other brand's car", text: "mhero 2 hp?" },
  {
    label: "Fake Meta support",
    text: "Meta Business Support: your page will be permanently disabled. Appeal here https://example.com/appeal",
  },
  { label: "“feel free”", text: "feel free to call me back" },
];
