/**
 * The knowledge with the 2026-09-18 decisions: every answer spoken. The engine's rules (which car is
 * meant, what is asked, negation, the four states) are tested under it, because their observable
 * effect was the sentence sent. Production uses MONZA_KNOWLEDGE, whose `silentHandoff` drops the 65
 * sentences Samer removed on 2026-10-06 — tested in tests/silent_handoff.test.ts.
 */
import { MONZA_KNOWLEDGE, TALKATIVE_DECISIONS, type SalesKnowledge } from "@/lib/wasales/knowledge";

export const TALKATIVE: SalesKnowledge = Object.freeze({ ...MONZA_KNOWLEDGE, decisions: TALKATIVE_DECISIONS });
