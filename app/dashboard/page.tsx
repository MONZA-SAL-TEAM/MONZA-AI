import type { Metadata } from "next";
import { aiDb } from "@/lib/db";
import { requireStaffForPage } from "@/lib/auth-server";
import { readDashboard, type DashboardData, type Slice } from "@/lib/leads/analytics";
import { formatLebanesePhone } from "@/lib/leads/phone";
import type { ExecutionContext } from "@/lib/connectors/types";

export const metadata: Metadata = {
  title: "Dashboard — Monza AI",
};

export const dynamic = "force-dynamic";

/**
 * /dashboard — who came, where from, what they wanted, and who bought.
 *
 * ── What this page is careful about ─────────────────────────────────────────
 *
 * It reports two populations that are NOT read the same way. Leads come from
 * MONZA AI's own records; sales come from the CRM under this staff member's
 * own token. So the page shows them side by side and never divides one by the
 * other — a conversion rate across that seam would be wrong in a way nobody
 * looking at it could detect.
 *
 * "Not tracked" means exactly that. It is never relabelled "organic" or "word
 * of mouth", never hidden so the remaining slices add to a tidy 100%. Somebody
 * decides where to spend money using this page.
 *
 * A hidden figure renders as "—", never as 0. "You sold nothing" and "your
 * account cannot see sales orders" must never look identical.
 */

/* ── Pieces ──────────────────────────────────────────────────────────────── */

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | null;
  hint: string;
}) {
  return (
    <div className="card pad-lg grow" style={{ minWidth: 168 }}>
      <div className="eyebrow">{label}</div>
      <div
        style={{
          fontFamily: "var(--font-display), var(--font-body), sans-serif",
          fontSize: 42,
          fontWeight: 640,
          letterSpacing: "-.03em",
          lineHeight: 1.15,
          marginTop: 8,
          // A withheld number is greyed as well as dashed, so it does not read
          // as a real value at a glance.
          color: value === null ? "var(--ink-3)" : undefined,
        }}
      >
        {value === null ? "—" : value}
      </div>
      <div className="cap" style={{ color: "var(--ink-3)", marginTop: 4 }}>
        {hint}
      </div>
    </div>
  );
}

/**
 * A proportional bar list.
 *
 * Bars are measured against the LARGEST slice, not against the total, so a
 * chart of five roughly-equal sources stays readable. The count is always
 * printed next to the bar — the bar is the shape, the number is the fact.
 */
function Breakdown({
  title,
  hint,
  slices,
  emptyNote,
}: {
  title: string;
  hint: string;
  slices: Slice[];
  emptyNote: string;
}) {
  const max = slices.reduce((m, s) => Math.max(m, s.count), 0);

  return (
    <div className="card">
      <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--line-soft)" }}>
        <div style={{ fontWeight: 600 }}>{title}</div>
        <div className="cap">{hint}</div>
      </div>
      {slices.length === 0 ? (
        <div className="empty" style={{ height: "auto", padding: 40 }}>
          <p className="cap" style={{ margin: 0 }}>{emptyNote}</p>
        </div>
      ) : (
        <div>
          {slices.map((s) => (
            <div
              key={s.key}
              style={{ padding: "12px 24px", borderBottom: "1px solid var(--line-soft)" }}
            >
              <div className="row-between" style={{ marginBottom: 6 }}>
                <span style={{ color: s.certain ? undefined : "var(--ink-3)" }}>
                  {s.label}
                  {!s.certain && (
                    // Said out loud rather than left to the colour, because
                    // the distinction between "we know" and "we do not" is
                    // the whole value of this chart.
                    <span className="cap" style={{ marginLeft: 8 }}>
                      not reported by the platform
                    </span>
                  )}
                </span>
                <span className="tag">{s.count}</span>
              </div>
              <div
                aria-hidden="true"
                style={{
                  height: 6,
                  borderRadius: 3,
                  background: "var(--line-soft)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${max === 0 ? 0 : Math.round((s.count / max) * 100)}%`,
                    height: "100%",
                    borderRadius: 3,
                    background: s.certain ? "var(--ink-2)" : "var(--ink-3)",
                    opacity: s.certain ? 0.85 : 0.35,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function PeopleTable({ data }: { data: DashboardData }) {
  return (
    <div className="card">
      <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--line-soft)" }}>
        <div style={{ fontWeight: 600 }}>Who has been in touch</div>
        <div className="cap">
          Most recent first. A name in grey is somebody nobody has identified yet.
        </div>
      </div>

      {data.recent.length === 0 ? (
        <div className="empty" style={{ height: "auto", padding: 40 }}>
          <p className="cap" style={{ margin: 0 }}>Nobody has messaged yet.</p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr className="cap">
                {["Person", "Channel", "How they found you", "Interested in", "Last seen"].map(
                  (h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left",
                        padding: "10px 24px",
                        borderBottom: "1px solid var(--line-soft)",
                        fontWeight: 500,
                      }}
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {data.recent.map((r) => (
                <tr key={r.id}>
                  <td style={cell}>
                    <div style={{ fontWeight: 550 }}>
                      {r.crmCustomerName ?? r.displayName ?? (
                        <span style={{ color: "var(--ink-3)" }}>Not identified</span>
                      )}
                    </div>
                    <div className="cap" style={{ color: "var(--ink-3)" }}>
                      {r.phone
                        ? formatLebanesePhone(r.phone)
                        : r.identified
                          ? r.identifiedBy
                          : "no number on this channel"}
                    </div>
                  </td>
                  <td style={cell}>
                    {r.channel ? CHANNEL_WORDS[r.channel] ?? r.channel : "—"}
                    {r.brand && (
                      <div className="cap" style={{ color: "var(--ink-3)" }}>
                        {BRAND_WORDS[r.brand] ?? r.brand}
                      </div>
                    )}
                  </td>
                  <td style={cell}>
                    {r.source ? (
                      <>
                        <span style={{ color: r.source === "direct" ? "var(--ink-3)" : undefined }}>
                          {SOURCE_WORDS[r.source] ?? r.source}
                        </span>
                        {r.sourceDetail && (
                          <div className="cap" style={{ color: "var(--ink-3)" }}>
                            {r.sourceDetail}
                          </div>
                        )}
                      </>
                    ) : (
                      <span style={{ color: "var(--ink-3)" }}>—</span>
                    )}
                  </td>
                  <td style={cell}>
                    {r.interests.length === 0 ? (
                      <span style={{ color: "var(--ink-3)" }}>didn&apos;t name a car</span>
                    ) : (
                      r.interests.join(", ")
                    )}
                  </td>
                  <td style={cell}>{when(r.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const cell: React.CSSProperties = {
  padding: "14px 24px",
  borderBottom: "1px solid var(--line-soft)",
  verticalAlign: "top",
};

const CHANNEL_WORDS: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
};
const BRAND_WORDS: Record<string, string> = {
  voyah: "VOYAH",
  mhero: "MHERO",
  monza: "MONZA SAL",
};
const SOURCE_WORDS: Record<string, string> = {
  ad_click: "Paid ad",
  social_post: "A post or story",
  website: "The website",
  direct: "Not tracked",
  staff_recorded: "Recorded by staff",
};

/* ── The page ────────────────────────────────────────────────────────────── */

export default async function DashboardPage() {
  const user = await requireStaffForPage("/dashboard");
  const supabase = aiDb();

  // A page view is not an assistant turn, so there is no conversation and no
  // turn to correlate — but the CRM reads inside still run under THIS user's
  // token, which is the part that matters. The audit trail for a page view is
  // the sign-in, not a tool call.
  const ctx: ExecutionContext = {
    user,
    conversationId: null,
    turnId: `dashboard-${Date.now()}`,
  };

  const data: DashboardData | null = supabase ? await readDashboard(supabase, ctx) : null;

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "36px 24px 64px" }}>
      <div className="stack-lg">
        <header className="stack" style={{ gap: 6 }}>
          <div className="eyebrow">Dashboard</div>
          <h1 className="h1">Where your customers come from</h1>
          <p className="lede">
            Everyone who has messaged VOYAH, MHERO or Monza SAL — which channel
            they used, what brought them, and which car they asked about. Worked
            out from the message itself, without anybody having to ask.
          </p>
        </header>

        <div className="aurora" aria-hidden="true" style={{ marginTop: -6 }} />

        {data === null ? (
          <div className="card">
            <div className="empty" style={{ height: "auto", padding: "56px 40px" }}>
              <div style={{ fontWeight: 600, color: "var(--ink-2)" }}>
                Not connected yet
              </div>
              <p className="cap" style={{ margin: 0, maxWidth: 460 }}>
                This deployment has no database configured, so there is nothing
                to count. The page stays empty rather than showing sample
                numbers that could be mistaken for yours.
              </p>
            </div>
          </div>
        ) : data.state === "unavailable" ? (
          // NOT the same screen as "nobody has messaged". The records could not
          // be read, so the truthful thing to say is that we do not know — a
          // page that reports a quiet month while blind is worse than one that
          // admits it is blind.
          <div className="card">
            <div className="empty" style={{ height: "auto", padding: "56px 40px" }}>
              <div style={{ fontWeight: 600, color: "var(--ink-2)" }}>
                These figures could not be loaded
              </div>
              <p className="cap" style={{ margin: 0, maxWidth: 500 }}>
                {data.caveats[0] ??
                  "The records could not be read just now."}{" "}
                This is not the same as having no customers — the page does not
                know either way, so it is showing nothing rather than zero.
              </p>
            </div>
          </div>
        ) : data.state === "nothing_yet" ? (
          <div className="card">
            <div className="empty" style={{ height: "auto", padding: "56px 40px" }}>
              <div style={{ fontWeight: 600, color: "var(--ink-2)" }}>
                Nobody has messaged yet
              </div>
              <p className="cap" style={{ margin: 0, maxWidth: 500 }}>
                The records were read successfully and there is genuinely
                nobody in them. No Instagram, Facebook or WhatsApp account is
                connected, so no conversations are arriving to count. Connect
                one on the Integrations page and everyone who writes from then
                on appears here — with where they came from and which car they
                asked about.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="row" style={{ alignItems: "stretch", gap: 14, flexWrap: "wrap" }}>
              <StatCard
                label="People"
                value={data.funnel.leads}
                hint="have messaged you"
              />
              <StatCard
                label="Identified"
                value={data.funnel.identified}
                hint={`${data.funnel.identifiedByPhone} by phone number`}
              />
              <StatCard
                label="Asked about a car"
                value={data.funnel.withInterest}
                hint="named a specific model"
              />
              <StatCard
                label="Cars sold"
                value={data.funnel.carsSold}
                hint="recorded in the CRM"
              />
            </div>

            {data.funnel.awaitingReview > 0 && (
              <div className="card pad-lg">
                <div style={{ fontWeight: 600 }}>
                  {data.funnel.awaitingReview} waiting for you to confirm
                </div>
                <p className="cap" style={{ margin: "4px 0 0", maxWidth: 620 }}>
                  These people look like customers you already have, but the
                  only evidence is a similar name — and names are not proof.
                  Nothing is linked until somebody who can tell says so.
                </p>
              </div>
            )}

            {/* Stated once, prominently, rather than as a footnote under each
                number it affects. */}
            {data.caveats.length > 0 && (
              <div className="card pad-lg">
                <div className="eyebrow">Not everything could be read</div>
                <ul className="cap" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                  {data.caveats.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            )}

            <Breakdown
              title="How they found you"
              hint="Their first arrival. Paid ads and posts are reported by Meta itself; the rest is genuinely unknown."
              slices={data.bySource}
              emptyNote="No arrivals recorded yet."
            />

            <Breakdown
              title="Which channel"
              hint="Where the first message came in."
              slices={data.byChannel}
              emptyNote="No channels have delivered a message yet."
            />

            <Breakdown
              title="Which car they asked about"
              hint="Counted from the model named in the message, using the same matcher that sends the brochures."
              slices={data.topInterests}
              emptyNote="Nobody has named a specific model yet."
            />

            <PeopleTable data={data} />

            <p className="cap" style={{ color: "var(--ink-3)", maxWidth: 640 }}>
              People and sales are counted from two different systems — this
              product&apos;s own records, and the CRM as your account can see
              it. They are shown side by side and deliberately not divided into
              a conversion rate, which would be misleading.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
