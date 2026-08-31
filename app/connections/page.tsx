import type { Metadata } from "next";
import ConnectionsClient from "./ConnectionsClient";

export const metadata: Metadata = {
  title: "Connections — Monza AI",
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
          <div className="eyebrow">Connections</div>
          <h1 className="h1">What the assistant can see</h1>
          <p className="lede">
            Think of this as a checklist: each system below is one thing the
            assistant can answer questions from. Everything runs with your own
            sign-in — the assistant never sees more than you can.
          </p>
        </header>
        <ConnectionsClient />
      </div>
    </main>
  );
}
