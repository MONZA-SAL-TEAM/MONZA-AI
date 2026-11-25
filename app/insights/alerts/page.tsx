import type { Metadata } from "next";
import { requireInsightsAccess } from "@/lib/auth-server";
import NotAllowed from "../NotAllowed";
import { InsightsNav } from "../parts";
import AlertsClient from "./AlertsClient";
import "../../board.css";
import "../insights.css";

export const metadata: Metadata = { title: "Alerts and waiting customers — Monza AI Insights" };
export const dynamic = "force-dynamic";

/**
 * Alerts a person can trust (Samer, 2026-11-25). Every open alert with what it really is and the
 * evidence for it; who is genuinely waiting, for how long and whose they are; the test-drive
 * requests; and the review before anything is closed. Owner and managers.
 */
export default async function AlertsPage() {
  const access = await requireInsightsAccess("/insights/alerts");
  if (!access.allowed) return <NotAllowed />;
  return (
    <div className="board">
      <header className="board-head">
        <p className="eyebrow">Insights · Alerts and waiting customers</p>
        <h1 className="h1">Who is really waiting, and whose are they</h1>
        <p className="lede">
          Every open alert is one of six things, each with its evidence. Only two close by themselves — a customer a person answered, and a second alert
          in the same chat. Where our side of a chat cannot be seen (Instagram, Facebook), it is shown as unverified, never as answered.
        </p>
      </header>
      <InsightsNav current="/insights/alerts" />
      <AlertsClient />
    </div>
  );
}
