/**
 * The websites' own tag at the end of a WhatsApp message (owner, 17 Nov 2026).
 *
 * The three websites end every pre-filled WhatsApp message with "(Ref V-7K2Q9M)"
 * (V / M / S = the site), and an older version wrote "Ref: web-mhero-1". It is
 * OUR text, not the customer's: lib/leads/attribution.ts reads it for "where
 * did they come from", and nothing that reads the customer's words may see it —
 * its letters and digits made the language detector call an English message
 * Arabizi, and a code could one day look like a car or a number.
 *
 * Removed only when it is exactly our tag and stands at the end of a line.
 */
const TAGS = [/\s*\(Ref [VMS]-[A-HJ-NP-Z2-9]{6}\)[ \t]*(?=\n|$)/g, /\s*\bRef:\s*web-[a-z0-9-]{1,60}[ \t]*(?=\n|$)/gi];

export function stripWebsiteRef(text: string): string;
export function stripWebsiteRef(text: string | null | undefined): string | null | undefined;
export function stripWebsiteRef(text: string | null | undefined): string | null | undefined {
  if (typeof text !== "string" || text === "") return text;
  let out = text;
  for (const tag of TAGS) out = out.replace(tag, "");
  return out === text ? text : out.trim();
}
