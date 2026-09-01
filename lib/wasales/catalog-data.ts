/**
 * WhatsApp Sales — the seed catalog the control page starts from.
 *
 * Fixed, deterministic example data: every file name is invented and clearly
 * an example — no real asset exists behind any of them. In the live system
 * the catalog rows come from the CRM and the files from the media library
 * uploaded with the WhatsApp Business connection work.
 *
 * Alias policy (feeds the matcher directly):
 *   - model-only words ("free", "dream", "passion", "courage", "917") so a
 *     customer never has to type "Voyah";
 *   - common misspellings ("pasion", "pashion", "dreem", "curage", "mhiro")
 *     as EXACT aliases, on top of the matcher's own edit-distance tolerance;
 *   - variant models list their variant phrase ("passion l", "pasion l") and
 *     NEVER the bare base word — the matcher's most-specific-wins rule needs
 *     the Passion L to claim only messages that show the L.
 *
 * The Voyah Courage ships WITHOUT a brochure on purpose: it demonstrates the
 * "won't auto-send — missing brochure" state and the Ready-to-send count.
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
    videos: [
      { label: "Walkaround", fileName: "voyah-free-walkaround.mp4" },
      { label: "Interior tour", fileName: "voyah-free-interior.mp4" },
    ],
    brochure: { label: "Brochure (PDF)", fileName: "voyah-free-brochure.pdf" },
    oneLiner: "Mid-size electric SUV — the range-anxiety killer.",
  },
  {
    id: "voyah-dream",
    name: "Voyah Dream",
    enabled: true,
    aliases: ["dream", "dreem", "drim", "voyah dream", "voya dream"],
    videos: [
      { label: "Walkaround", fileName: "voyah-dream-walkaround.mp4" },
      { label: "Cabin & seats", fileName: "voyah-dream-cabin.mp4" },
    ],
    brochure: { label: "Brochure (PDF)", fileName: "voyah-dream-brochure.pdf" },
    oneLiner: "Luxury electric MPV — the family flagship.",
  },
  {
    id: "voyah-passion",
    name: "Voyah Passion",
    enabled: true,
    aliases: ["passion", "pasion", "pashion", "passon", "voyah passion"],
    videos: [
      { label: "Walkaround", fileName: "voyah-passion-walkaround.mp4" },
      { label: "Drive & tech", fileName: "voyah-passion-drive.mp4" },
    ],
    brochure: {
      label: "Brochure (PDF)",
      fileName: "voyah-passion-brochure.pdf",
    },
    oneLiner: "Electric executive sedan — quiet, quick, composed.",
  },
  {
    id: "voyah-passion-l",
    name: "Voyah Passion L",
    enabled: true,
    // Variant phrases ONLY — never the bare word "passion" (see header note).
    aliases: ["passion l", "pasion l", "pashion l", "passion el", "passionl"],
    videos: [
      { label: "Walkaround", fileName: "passion-l-walkaround.mp4" },
      { label: "Rear-cabin tour", fileName: "passion-l-rear-cabin.mp4" },
    ],
    brochure: { label: "Brochure (PDF)", fileName: "passion-l-brochure.pdf" },
    oneLiner: "Long-wheelbase Passion — the chauffeured option.",
  },
  {
    id: "voyah-courage",
    name: "Voyah Courage",
    enabled: true,
    aliases: ["courage", "curage", "corage", "courge", "voyah courage"],
    videos: [
      { label: "Walkaround", fileName: "voyah-courage-walkaround.mp4" },
      { label: "City drive", fileName: "voyah-courage-city.mp4" },
    ],
    // Missing on purpose — shows the honest "won't auto-send" state.
    brochure: null,
    oneLiner: "Compact electric SUV — the accessible entry to Voyah.",
  },
  {
    id: "mhero-917",
    name: "MHERO 917",
    enabled: true,
    aliases: ["917", "mhero", "m hero", "mhero 917", "m hero 917", "mhiro"],
    videos: [
      { label: "Off-road showcase", fileName: "mhero-917-offroad.mp4" },
      { label: "Walkaround", fileName: "mhero-917-walkaround.mp4" },
    ],
    brochure: { label: "Brochure (PDF)", fileName: "mhero-917-brochure.pdf" },
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
