import type { Metadata } from "next";
import { requireInsightsAccess } from "@/lib/auth-server";
import NotAllowed from "./NotAllowed";
import { readInsights } from "@/lib/insights/insights-server";
import { readCrmStock } from "@/lib/insights/crm-server";
import { stockByModel } from "@/lib/insights/crm";
import { readMetaRuns } from "@/lib/insights/meta-backfill";
import InsightsClient, { type StockView } from "./InsightsClient";

export const metadata: Metadata = {
  title: "Insights — Monza AI",
};

/**
 * /insights — what the conversations say about the cars and the clients (Samer, 2026-10-12).
 *
 * Built from the sales signals the bot records on every message (lib/wasales/signal.ts): which car,
 * which question, which colour, how far the customer went. Never a message's words. Read-only.
 */
export const dynamic = "force-dynamic";

const PERIODS = new Set([30, 90, 365, 0]);

export default async function InsightsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireInsightsAccess("/insights");
  if (!access.allowed) return <NotAllowed />;
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  const daysRaw = Number(one("days") ?? 90);
  const days = PERIODS.has(daysRaw) ? daysRaw : 90;
  const brand = one("brand");
  const channel = one("channel");
  const model = one("model");
  const filter = {
    days,
    brand: brand && /^[a-z]+$/.test(brand) ? brand : null,
    channel: channel && /^[a-z]+$/.test(channel) ? channel : null,
    model: model && /^[A-Z0-9_]+$/.test(model) ? model : null,
    now: new Date().toISOString(),
  };
  const [read, crmStock, metaRuns] = await Promise.all([readInsights(filter), readCrmStock(access.user), readMetaRuns().catch(() => [])]);
  const stock: StockView = crmStock.state === "ok" ? { state: "ok", byModel: Object.fromEntries(stockByModel(crmStock.data)) } : crmStock;
  return <InsightsClient read={read} filter={filter} stock={stock} metaRuns={metaRuns} />;
}
