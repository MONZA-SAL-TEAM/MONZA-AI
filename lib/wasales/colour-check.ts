/**
 * "Is this video really the right car and the right colour?"
 *
 * WHAT THIS CANNOT DO, said plainly because the difference matters: it does
 * not look at the footage. Nothing here can tell that a clip shows a black
 * Taishan rather than a grey one — that needs a person's eyes, or a vision
 * model nobody should trust with what a customer receives.
 *
 * WHAT IT DOES is read the FILE NAME and compare it with the car and colour
 * the file is being filed under, and notice when the same file already sits
 * somewhere else. That sounds weak. It is not: the one real mis-filing in
 * Monza's own folder — a Passion L video sitting in Voyah Passion / Black —
 * was caught exactly this way, by its name, before anybody watched it.
 *
 * So every result here is a WARNING with a reason, never a verdict, and the
 * caller must let a person overrule it. Blocking on a name would be worse than
 * useless: file names are often meaningless ("copy_C81B4DD7-817D.mov" is a
 * real one from the Taishan folder), and a check that refuses those would
 * train people to ignore it.
 */

import type { WaCar } from "@/lib/wasales/matcher";
import { colourNameFrom } from "@/lib/wasales/media-paths";

/** One thing worth a second look before this file goes in. */
export interface ColourWarning {
  /** Machine-readable, so the UI can style or group without parsing prose. */
  kind: "other-colour" | "other-car" | "duplicate" | "no-evidence";
  /** What to show a person. Complete sentences; they appear verbatim. */
  message: string;
}

/** A file already in the library, as much as the checker needs to know. */
export interface ExistingFile {
  carId: string;
  colourId: string | null;
  /** The original name, not the stored `<id>__<name>` form. */
  name: string;
  size: number;
}

export interface CheckInput {
  car: WaCar;
  /** The colour id it is being filed under. */
  colourId: string;
  fileName: string;
  size: number;
  /** Everything already uploaded, across every car. */
  existing: readonly ExistingFile[];
  /** The other cars, so a name can be tested against them. */
  catalog: readonly WaCar[];
}

/* ── Reading a file name ─────────────────────────────────────────────────── */

/** Lowercased, punctuation flattened to spaces, so words can be matched. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "") // drop the extension
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w !== "");
}

/** Does this phrase appear as whole words in the name? */
function mentions(nameWords: string[], phrase: string): boolean {
  const parts = words(phrase);
  if (parts.length === 0) return false;
  for (let i = 0; i + parts.length <= nameWords.length; i++) {
    let ok = true;
    for (let j = 0; j < parts.length; j++) {
      if (nameWords[i + j] !== parts[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * Every colour word the name mentions, whether or not this car has it.
 *
 * Drawn from the car's own colours plus the plain English colour words, so a
 * file called "Courage White.mov" is understood even before White exists as a
 * folder — which is exactly when somebody is adding it.
 */
const COMMON_COLOURS = [
  "black", "white", "grey", "gray", "silver", "blue", "red", "green",
  "yellow", "orange", "purple", "brown", "beige", "gold", "bronze", "pink",
  "sage", "titanium", "pearl", "crayon",
];

function colourWordsIn(nameWords: string[], car: WaCar): string[] {
  const vocabulary = new Set<string>(COMMON_COLOURS);
  for (const c of car.colours) {
    for (const w of words(c.name)) vocabulary.add(w);
    for (const alias of c.aliases) for (const w of words(alias)) vocabulary.add(w);
  }
  return [...vocabulary].filter((w) => nameWords.includes(w));
}

/* ── The check ───────────────────────────────────────────────────────────── */

/**
 * Everything worth flagging about filing this file here. An empty array means
 * nothing looked wrong — NOT that the video was verified.
 */
export function checkColourFit(input: CheckInput): ColourWarning[] {
  const { car, colourId, fileName, size, existing, catalog } = input;
  const out: ColourWarning[] = [];
  const nameWords = words(fileName);

  const target = car.colours.find((c) => c.id === colourId);
  const targetName = target?.name ?? colourNameFrom(colourId);

  /* 1. Does the name name a DIFFERENT colour? */
  const targetWords = new Set([
    ...words(targetName),
    ...(target?.aliases.flatMap((a) => words(a)) ?? []),
  ]);
  const found = colourWordsIn(nameWords, car);
  const otherColours = found.filter((w) => !targetWords.has(w));
  if (otherColours.length > 0) {
    out.push({
      kind: "other-colour",
      message:
        `The file name says "${otherColours.join('", "')}", but you are filing ` +
        `it under ${targetName}. Check it is the right clip.`,
    });
  }

  /* 2. Does the name name a DIFFERENT car?
   *
   * MOST SPECIFIC WINS — the same rule the model matcher uses, and it has to
   * be, because the model names overlap: "Voyah Passion" is a prefix of
   * "Voyah Passion L".
   *
   * Two wrong versions of this were written before the right one. Comparing
   * against every other name flagged every Passion L file, because each one
   * also contains "Voyah Passion". Skipping whenever either name contained
   * the other then silenced the case that actually happened — a Passion L
   * clip sitting in the Voyah Passion folder — because that pair is exactly
   * the one it skipped.
   *
   * So: find the LONGEST model name the file name mentions, and compare that
   * one to where the file is going. "Voyah Passion L in Black" names Passion L
   * more specifically than Passion, and belongs to whichever the winner is. */
  let best: WaCar | null = null;
  let bestWords = 0;
  for (const candidate of catalog) {
    const length = words(candidate.name).length;
    if (length <= bestWords) continue;
    if (!mentions(nameWords, candidate.name)) continue;
    best = candidate;
    bestWords = length;
  }
  if (best && best.id !== car.id) {
    out.push({
      kind: "other-car",
      message:
        `The file name says ${best.name}, but you are filing it under the ` +
        `${car.name}. Check it is the right car.`,
    });
  }

  /* 3. Is this the same file as one already filed somewhere else?
   *
   * Name AND size together — either alone is too loose. Two shoots genuinely
   * produce "video.mp4"; two files of identical name and byte count are the
   * same export. */
  const twin = existing.find(
    (f) =>
      f.size === size &&
      f.name.toLowerCase() === fileName.toLowerCase() &&
      !(f.carId === car.id && f.colourId === colourId)
  );
  if (twin) {
    const wherePut = twin.colourId
      ? `${carNameOf(catalog, twin.carId)} / ${colourNameOf(catalog, twin.carId, twin.colourId)}`
      : carNameOf(catalog, twin.carId);
    out.push({
      kind: "duplicate",
      message:
        `This exact file is already filed under ${wherePut}. ` +
        `One of the two is in the wrong place.`,
    });
  }

  /* 4. Nothing in the name says anything either way.
   *
   * Reported so that "no warnings" never reads as "checked and correct". Half
   * of Monza's real files are named copy_C81B4DD7-817D.mov. */
  if (out.length === 0 && found.length === 0) {
    out.push({
      kind: "no-evidence",
      message:
        `Nothing in the file name confirms the colour — please make sure ` +
        `this clip really shows the ${targetName} ${car.name}.`,
    });
  }

  return out;
}

function carNameOf(catalog: readonly WaCar[], carId: string): string {
  return catalog.find((c) => c.id === carId)?.name ?? carId;
}

function colourNameOf(
  catalog: readonly WaCar[],
  carId: string,
  colourId: string
): string {
  const car = catalog.find((c) => c.id === carId);
  return car?.colours.find((c) => c.id === colourId)?.name ?? colourNameFrom(colourId);
}
