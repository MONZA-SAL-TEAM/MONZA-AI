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
    <div className="card pad grow">
      <div className="eyebrow">{label}</div>
      <div
        style={{ fontSize: 32, fontWeight: 620, letterSpacing: "-.02em", marginTop: 6 }}
      >
        {value}
      </div>
      <div className="cap" style={{ color: "var(--ink-3)", marginTop: 2 }}>
        {hint}
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  const stats = await readTodayStats();

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "32px 20px" }}>
      <div className="stack-lg">
        <header className="stack" style={{ gap: 6 }}>
          <div className="eyebrow">Dashboard</div>
          <h1 className="h1">Today at a glance</h1>
          <p className="lede">
            What the assistant has been asked and what it looked at — every
            single lookup is recorded, whether it was allowed or not.
          </p>
        </header>

        {stats === null ? (
          <div className="card">
            <div className="empty" style={{ height: "auto", padding: "56px 40px" }}>
              <div style={{ fontWeight: 600, color: "var(--ink-2)" }}>
                No activity data yet
              </div>
              <p className="cap" style={{ margin: 0, maxWidth: 420 }}>
                The assistant&apos;s own record-keeping is not connected, so
                there is nothing real to show — this page never invents
                numbers. Once it is connected, today&apos;s questions and
                lookups appear here automatically.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="row" style={{ alignItems: "stretch", gap: 12 }}>
              <StatCard
                label="Questions"
                value={stats.questions}
                hint="asked today"
              />
              <StatCard
                label="Lookups"
                value={stats.lookups}
                hint="checks across the systems"
              />
              <StatCard
                label="Not permitted"
                value={stats.denied}
                hint="stopped by permissions, and recorded"
              />
            </div>

            <div className="card">
              <div className="pad" style={{ borderBottom: "1px solid var(--line-soft)" }}>
                <div style={{ fontWeight: 600 }}>Lookups by system</div>
                <div className="cap">Where today&apos;s answers came from.</div>
              </div>
              {stats.bySystem.length === 0 ? (
                <div className="empty" style={{ height: "auto", padding: "40px" }}>
                  <p className="cap" style={{ margin: 0 }}>
                    Quiet so far — no questions have needed a lookup today.
                  </p>
                </div>
              ) : (
                <div>
                  {stats.bySystem.map((s) => (
                    <div
                      key={s.label}
                      className="row-between"
                      style={{
                        padding: "12px 18px",
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
