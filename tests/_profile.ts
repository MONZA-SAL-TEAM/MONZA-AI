/** Read customer lines as one conversation through the real engine; return every fact (tests only). */
import { readConversation, type Turn } from "@/lib/wasales/reader";
import type { Observation } from "@/lib/wasales/observe";
import { MONZA_KNOWLEDGE } from "@/lib/wasales/knowledge";
import { loadCatalog } from "@/lib/wasales/catalog";
import { liveMedia } from "@/tests/_live-library";

const DEPS = { knowledge: MONZA_KNOWLEDGE, catalog: loadCatalog(), media: liveMedia, ttlHours: 72 };
const META = { accountId: "wa-monza", brand: "monza", channel: "whatsapp", conversationId: "c1" };

export function factsOf(...lines: string[]): Observation[] {
  const turns: Turn[] = lines.map((text, i) => ({ author: "customer", text, hasMedia: false, at: new Date(Date.parse("2026-10-12T09:00:00Z") + i * 60_000).toISOString(), externalMessageId: `m${i}` }));
  return readConversation(turns, META, DEPS).results.flatMap((r) => r.observations);
}
