import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Automations — Monza AI",
};

/**
 * /automations — an honest placeholder. Nothing here runs yet, and the page
 * says so plainly rather than pretending. It exists so the destination is
 * visible: scheduled questions, delivered like any other answer.
 */

const PLANNED = [
  {
    title: "Morning overdue summary",
    example:
      "“Every morning at 8:00 — who is overdue on installments, and by how much?” delivered to the owner.",
  },
  {
    title: "Weekly garage wrap-up",
    example:
      "“Every Friday afternoon — job cards finished this week, and anything still waiting on parts.”",
  },
  {
    title: "Stock watch",
    example:
      "“Tell me when any fast-moving part drops below five on the shelf.”",
  },
];

export default function AutomationsPage() {
  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "32px 20px" }}>
      <div className="stack-lg">
        <header className="stack" style={{ gap: 6 }}>
          <div className="row" style={{ gap: 10 }}>
            <div className="eyebrow">Automations</div>
            <span className="tag">Not built yet</span>
          </div>
          <h1 className="h1">Questions that ask themselves</h1>
          <p className="lede">
            The plan: schedule a question once, and the assistant asks it for
            you right on time — same permissions, same record-keeping as
            asking by hand. None of this exists yet, and this page won&apos;t
            pretend otherwise.
          </p>
        </header>

        <div className="stack">
          {PLANNED.map((p) => (
            <div key={p.title} className="card pad">
              <div className="row" style={{ gap: 8 }}>
                <span style={{ fontWeight: 600 }}>{p.title}</span>
                <span className="tag">Planned</span>
              </div>
              <p className="cap" style={{ margin: "6px 0 0" }}>
                {p.example}
              </p>
            </div>
          ))}
        </div>

        <div className="note">
          When this ships, a scheduled question will run with the access of
          the person who scheduled it — never more — and every run will show
          up on the dashboard like any other question. No surprises.
        </div>
      </div>
    </main>
  );
}
