/**
 * The insights observer's closed vocabularies — English, French, Arabizi and Arabic, written the way
 * normalize() leaves them (lower case, no punctuation, Arabic without diacritics; ة→ه, ى→ي).
 *
 * Deliberately SEPARATE from the bot's lexicon (intent.ts): words added here change what is COUNTED,
 * never what the bot SAYS. Every value an observation can carry is a key of one of these maps, so the
 * database's `^[a-z0-9_]+$` check is satisfied by construction and no customer word can land.
 */

/** Colour families, exterior or interior. The key is the stored value. */
export const COLOUR_FAMILIES: Readonly<Record<string, readonly string[]>> = {
  black: ["black", "noir", "noire", "aswad", "asswad", "sawda", "sooda", "souda", "اسود", "سودا", "سوداء"],
  white: ["white", "blanc", "blanche", "abyad", "abiad", "abyed", "bayda", "beda", "baida", "ابيض", "بيضا", "بيضاء"],
  grey: ["grey", "gray", "gris", "rmadi", "rmede", "ramadi", "rmadeh", "rasasi", "rsase", "رمادي", "رصاصي"],
  silver: ["silver", "argent", "fadde", "faddi", "fedde", "فضي"],
  blue: ["blue", "bleu", "azra2", "azrak", "azraq", "azra", "navy", "ka7le", "kahle", "ازرق", "زرقا", "كحلي"],
  green: ["green", "vert", "verte", "akhdar", "a5dar", "akhdar", "ikhdar", "khadra", "اخضر", "خضرا"],
  red: ["red", "rouge", "ahmar", "a7mar", "hamra", "7amra", "احمر", "حمرا"],
  yellow: ["yellow", "jaune", "asfar", "safra", "اصفر"],
  orange: ["orange", "bourte2ane", "برتقالي"],
  brown: ["brown", "marron", "bonne", "bunni", "bounni", "tan", "cognac", "camel", "بني"],
  beige: ["beige", "bej", "beij", "cream", "creme", "krem", "بيج"],
  gold: ["gold", "golden", "dahabe", "dahabi", "ذهبي"],
  purple: ["purple", "violet", "mauve", "banafsaje", "بنفسجي"],
  pink: ["pink", "rose", "zahri", "zahre", "زهري"],
};

/** Words that only an official colour name carries ("sage" → Sage Green). Matched against the workbook's names. */
export const COLOUR_NAME_WORDS: readonly string[] = ["midnight", "british", "racing", "titanium", "sage", "pearl", "crayon", "obsidian", "sapphire", "storm", "recon", "piano", "olive", "clouds", "polar"];

/** The colour is the INSIDE of the car. */
export const INTERIOR_MARKERS: readonly string[] = [
  "interior", "inside", "inner", "cabin", "seat", "seats", "leather", "upholstery", "trim",
  "fersh", "farsh", "ferch", "jowa", "jouwa", "juwa", "jowwa", "joua", "interieur",
  "مقاعد", "مقعد", "فرش", "جوا", "داخل", "الداخل", "الداخليه", "داخليه", "جلد",
];

/** The colour is the OUTSIDE (overrides an interior word elsewhere in the clause). */
export const EXTERIOR_MARKERS: readonly string[] = ["outside", "exterior", "outer", "body", "paint", "barra", "berra", "exterieur", "برا", "الخارج", "خارج"];

/** "Anything except white", "kel shi ella el abyad", "أي لون غير الأبيض". */
export const EXCEPT_WORDS: readonly string[] = ["except", "excluding", "besides", "ella", "illa", "ela", "gher", "ghair", "ghayr", "ghir", "sauf", "غير", "الا", "عدا", "ماعدا"];
/** "anything but black": "but" excepts only after these. */
export const BUT_AFTER: readonly string[] = ["anything", "everything", "all", "any"];

/** A wish: "I want the black", "bade el aswad", "بدي الأسود". */
export const WANT_WORDS: readonly string[] = [
  "want", "wanna", "like", "prefer", "love", "choose", "pick", "take", "need",
  "bade", "bde", "badde", "baddi", "bdi", "bidde", "bedde", "7abbet", "habbet", "7abb", "habb", "a7la", "ahla", "ahsan", "a7san",
  "veux", "voudrais", "prefere", "aime",
  "بدي", "بدنا", "بحب", "حابب", "حبيت", "اريد", "افضل", "احلى", "احسن", "عاجبني", "بفضل",
];

/** "Any colour is fine": only counted when the message is about colour. */
export const NO_PREFERENCE_PHRASES: readonly string[] = [
  "any colour", "any color", "any colours", "any colors", "whatever colour", "whatever color", "all colours", "all colors",
  "doesn t matter", "does not matter", "dont mind", "don t mind", "no preference", "up to you", "you choose",
  "ay lon", "ay lawn", "ay loun", "ayya lon", "ma bhem", "mesh mhem", "msh mhem", "3adi", "aadi", "kel el alwen",
  "n importe", "peu importe",
  "اي لون", "مش مهم", "ما بتفرق", "عادي", "كل الالوان",
];

/** Words that are about colour, so a no-preference phrase counts. */
export const COLOUR_TOPIC_WORDS: readonly string[] = ["colour", "color", "colours", "colors", "couleur", "lon", "lawn", "loun", "alwen", "alwan", "لون", "الوان", "اللون"];

/** Words a model's mention may be compared with. */
export const COMPARE_WORDS: readonly string[] = ["vs", "versus", "compare", "comparison", "difference", "better", "or", "aw", "walla", "او", "ولا", "مقارنه", "الفرق"];

/** A colour accepted as a second choice: "black first, but grey is fine" — grey is an alternative. */
export const ALTERNATIVE_WORDS: readonly string[] = [
  "fine", "ok", "okay", "acceptable", "works", "also good", "second choice", "backup", "mashi", "meshi", "ma3le", "ma3lesh",
  "mish moshkle", "msh moshkle", "mesh moshkle", "ماشي", "مقبول", "مش مشكله", "معليش", "ca va", "aussi",
];
