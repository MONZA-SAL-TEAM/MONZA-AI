import type { Metadata } from "next";
import ConnectionsClient from "./ConnectionsClient";

export const metadata: Metadata = {
  title: "Connections — Monza Assistant",
};

/**
 * /connections — the connector map made visible.
 *
 * The page itself is a shell; the live statuses come from GET /api/connections
 * (server-side status checks, no secrets in the browser) rendered by the
 * client component below.
 */
export default function ConnectionsPage() {
  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "32px 20px" }}>
      <div className="stack-lg">
        <header className="stack" style={{ gap: 6 }}>
          <p className="cap" style={{ margin: 0, color: "var(--ink-3)" }}>
            This page is for the Monza team — customers never see it.
          </p>
          <div className="eyebrow">Connections</div>
          <h1 className="h1">What the assistant can see</h1>
          <p className="lede">
            Think of this as a checklist: each system below is one thing the
            assistant can answer customer questions from. A customer only ever
            sees their own records — their car, their plan, their garage job —
            plus public information.
          </p>
        </header>
        <ConnectionsClient />
      </div>
    </main>
  );
}
