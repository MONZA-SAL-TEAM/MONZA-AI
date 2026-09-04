import type { Metadata } from "next";
import { requireStaffForPage } from "@/lib/auth-server";
import ConnectionsClient from "./ConnectionsClient";

export const metadata: Metadata = {
  title: "Integrations — Monza AI",
};

/**
 * /integrations — what this deployment is joined up to.
 *
 * Two halves, and the distinction matters:
 *
 *   SOURCES  systems Monza AI READS — customers, vehicles, installments,
 *            payments. They stay authoritative; nothing here writes to them.
 *   CHANNELS ways Monza AI TALKS — WhatsApp, Instagram, Facebook. None is
 *            connected yet, which is why nothing sends and every automation
 *            is switched off.
 *
 * The page is a shell; live statuses come from GET /api/connections (checks run
 * server-side, no secrets in the browser).
 */
export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  await requireStaffForPage("/integrations");
  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "36px 24px 64px" }}>
      <div className="stack-lg">
        <header className="stack" style={{ gap: 6 }}>
          <div className="eyebrow">System</div>
          <h1 className="h1">What Monza AI is joined up to</h1>
          <p className="lede">
            Two kinds of connection: the systems it reads from, and the channels
            it talks on. Reading runs with your own sign-in — the assistant
            never sees more than you can.
          </p>
        </header>
        <div className="aurora" aria-hidden="true" style={{ marginTop: -6 }} />

        <section className="stack" aria-label="Channels">
          <h2 className="h2">Channels</h2>
          <p className="cap">
            How Monza AI would reach a customer. Until one of these is
            connected, nothing is sent automatically and every message on the
            follow-up screens is something a person taps send on.
          </p>
          <div className="card pad">
            <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              <li className="row-between">
                <span>WhatsApp Business</span>
                <span className="tag">Not connected</span>
              </li>
              <li className="row-between">
                <span>Instagram messaging</span>
                <span className="tag">Not connected</span>
              </li>
              <li className="row-between">
                <span>Facebook Messenger</span>
                <span className="tag">Not connected</span>
              </li>
            </ul>
          </div>
        </section>

        <section className="stack" aria-label="Sources">
          <h2 className="h2">Sources</h2>
          <p className="cap">
            Systems the assistant reads from. Each stays in charge of its own
            data — Monza AI asks at question time and keeps no copy.
          </p>
          <ConnectionsClient />
        </section>
      </div>
    </main>
  );
}
