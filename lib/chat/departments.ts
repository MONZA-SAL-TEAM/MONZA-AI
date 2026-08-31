import type { RecommendedChat } from "@/lib/chat/contract";
import { RECOMMENDED_CHATS } from "@/lib/chat/demo-answers";

/**
 * The five department pages — one per welcome card. Built FROM
 * RECOMMENDED_CHATS so the labels, blurbs and questions on a department page
 * can never drift from the welcome screen: there is exactly one source of
 * truth, and this file only adds a URL slug on top of it.
 *
 * Pure data + pure functions; importable from server and client components.
 */

export interface Department {
  /** URL slug, plain words: /departments/<slug>. */
  slug: string;
  key: RecommendedChat["key"];
  label: string;
  blurb: string;
  questions: string[];
  /** The department's headline question — its first recommended question. */
  flagship: string;
}

/** Fixed slugs — these are public URLs, so they never change. */
const SLUG_BY_KEY: Record<RecommendedChat["key"], string> = {
  crm: "customers-sales",
  installments: "installments-payments",
  garage: "garage-service",
  inventory: "vehicles-parts",
  finance: "money-reports",
};

export const DEPARTMENTS: Department[] = RECOMMENDED_CHATS.map((rc) => ({
  slug: SLUG_BY_KEY[rc.key],
  key: rc.key,
  label: rc.label,
  blurb: rc.blurb,
  questions: rc.questions,
  flagship: rc.questions[0],
}));

export function departmentBySlug(slug: string): Department | null {
  return DEPARTMENTS.find((d) => d.slug === slug) ?? null;
}

/** Slug for a department key — for building links like /departments/<slug>. */
export function departmentSlug(key: RecommendedChat["key"]): string {
  return SLUG_BY_KEY[key];
}
