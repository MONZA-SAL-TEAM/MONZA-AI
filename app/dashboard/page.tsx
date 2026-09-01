import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";

export const metadata: Metadata = {
  title: "Dashboard — Monza AI",
};

export const dynamic = "force-dynamic";

/**
 * /dashboard — v1 usage overview, read from the AI's own audit_logs.
 *
 * Every tool call the assistant ever makes — allowed or denied — writes one
 * audit row, so this page is simply that table summarised for today. When the
 * AI database is not configured we say so honestly instead of inventing
 * numbers.
 */

/** Staff words for connector keys — raw keys never reach the screen.
    Mirrors the closed set in lib/permissions/kernel.ts. */
const CONNECTOR_LABELS: Record<string, string> = {
  crm: "Customers & Sales",
  installments: "Installments & Payments",
  finance: "Finance",
  garage: "Garage & Service",
  inventory: "Parts & Inventory",
};

interface AuditRow {
  turn_id: string | null;
  connector_key: string;
  allowed: boolean;
}

interface DayStats {
  questions: number;
  lookups: number;
  denied: number;
  bySystem: { label: string; count: number }[];
}

async function readTodayStats(): Promise<DayStats | null> {
  const url = process.env.NEXT_PUBLIC_AI_SUPABASE_URL;
  const serviceKey = process.env.AI_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  try {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false },
    });
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const { data, error } = await supabase
      .from("audit_logs")
      .select("turn_id,connector_key,allowed")
      .gte("created_at", startOfDay.toISOString())
      .limit(5000);

    if (error || !data) return null;

    const rows = data as AuditRow[];
    const turns = new Set<string>();
    const byKey = new Map<string, number>();
    let denied = 0;

    for (const r of rows) {
      if (r.turn_id) turns.add(r.turn_id);
      byKey.set(r.connector_key, (byKey.get(r.connector_key) ?? 0) + 1);
      if (!r.allowed) denied += 1;
    }

    const bySystem = Array.from(byKey.entries())
      .map(([key, count]) => ({
        label: CONNECTOR_LABELS[key] ?? "Other",
        count,
      }))
      .sort((a, b) => b.count - a.count);

    return { questions: turns.size, lookups: rows.length, denied, bySystem };
  } catch {
    return null;
  }
}

function StatCard({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="card pad-lg grow" style={{ minWidth: 180 }}>
      <div className="eyebrow">{label}</div>
      <div
        style={{
          fontFamily: "var(--font-display), var(--font-body), sans-serif",
          fontSize: 42,
          fontWeight: 640,
          letterSpacing: "-.03em",
          lineHeight: 1.15,
          marginTop: 8,
        }}
      >
        {value}
      </div>
      <div className="cap" style={{ color: "var(--ink-3)", marginTop: 4 }}>
        {hint}
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  const stats = await readTodayStats();

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "36px 24px 64px" }}>
      <div className="stack-lg">
        <header className="stack" style={{ gap: 6 }}>
          <div className="eyebrow">Dashboard</div>
          <h1 className="h1">Today at a glance</h1>
          <p className="lede">
            A plain view of the assistant&apos;s day — every question it was
            asked and every lookup it made, allowed or not. Nothing happens
            off the record.
          </p>
        </header>

        <div className="aurora" aria-hidden="true" style={{ marginTop: -6 }} />

        {stats === null ? (
          <div className="card">
            <div className="empty" style={{ height: "auto", padding: "56px 40px" }}>
              <div style={{ fontWeight: 600, color: "var(--ink-2)" }}>
                Nothing to show just yet
              </div>
              <p className="cap" style={{ margin: 0, maxWidth: 420 }}>
                The assistant&apos;s record-keeping isn&apos;t connected, so
                this page stays honestly empty — it never invents numbers.
                Once connected, you&apos;ll see today&apos;s questions and
                lookups here on their own, nothing extra to set up.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div
              className="row"
              style={{ alignItems: "stretch", gap: 14, flexWrap: "wrap" }}
            >
              <StatCard
                label="Questions"
                value={stats.questions}
                hint="asked so far today"
              />
              <StatCard
                label="Lookups"
                value={stats.lookups}
                hint="times the systems were checked"
              />
              <StatCard
                label="Not permitted"
                value={stats.denied}
                hint="stopped by permissions, and recorded"
              />
            </div>

            <div className="card">
              <div
                className="pad"
                style={{
                  padding: "18px 24px",
                  borderBottom: "1px solid var(--line-soft)",
                }}
              >
                <div style={{ fontWeight: 600 }}>Lookups by system</div>
                <div className="cap">Where today&apos;s answers came from.</div>
              </div>
              {stats.bySystem.length === 0 ? (
                <div className="empty" style={{ height: "auto", padding: "40px" }}>
                  <p className="cap" style={{ margin: 0 }}>
                    All quiet so far — no question has needed a lookup yet
                    today.
                  </p>
                </div>
              ) : (
                <div>
                  {stats.bySystem.map((s) => (
                    <div
                      key={s.label}
                      className="row-between"
                      style={{
                        padding: "14px 24px",
                        borderBottom: "1px solid var(--line-soft)",
                      }}
                    >
                      <span>{s.label}</span>
                      <span className="tag">{s.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
