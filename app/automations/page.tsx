import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Automations — Monza Assistant",
};

/**
 * /automations — an honest placeholder. Nothing here runs yet, and the page
 * says so plainly rather than pretending. It exists so the destination is
 * visible: scheduled updates for customers, delivered like any other answer.
 */

const PLANNED = [
  {
    title: "Installment reminders",
    example:
      "A few days before an installment is due, the customer gets a friendly reminder — before it becomes a problem.",
  },
  {
    title: "Garage updates",
    example:
      "When a waiting part arrives and work on a customer's car resumes, they hear about it without having to call.",
  },
  {
    title: "Service due notices",
    example:
      "When a customer's car comes up on its service interval, a gentle note invites them to book a visit.",
  },
];

export default function AutomationsPage() {
  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "32px 20px" }}>
      <div className="stack-lg">
        <header className="stack" style={{ gap: 6 }}>
          <p className="cap" style={{ margin: 0, color: "var(--ink-3)" }}>
            This page is for the Monza team — customers never see it.
          </p>
          <div className="row" style={{ gap: 10 }}>
            <div className="eyebrow">Automations</div>
            <span className="tag">Not built yet</span>
          </div>
          <h1 className="h1">Updates that send themselves</h1>
          <p className="lede">
            The plan: the assistant reaches out to customers on schedule —
            the reminders and updates they would otherwise call to ask for.
            Same permissions, same record-keeping as any answer. None of this
            exists yet, and this page won&apos;t pretend otherwise.
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
          When this ships, every scheduled update will use only that
          customer&apos;s own records — never anyone else&apos;s — and every
          run will show up on the dashboard like any other question. No
          surprises.
        </div>
      </div>
    </main>
  );
}
