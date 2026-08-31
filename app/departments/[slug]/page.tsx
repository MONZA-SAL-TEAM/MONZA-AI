import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { RecommendedChat } from "@/lib/chat/contract";
import { departmentBySlug } from "@/lib/chat/departments";
import { demoAnswer } from "@/lib/chat/demo-answers";
import DataTable from "@/components/DataTable";
import "../departments.css";

/**
 * One department, one page — /departments/<slug>. A server component: the
 * whole page is links and static text, so no client JavaScript is needed.
 * Content comes from lib/chat/departments.ts (which is built from
 * RECOMMENDED_CHATS), and the "At a glance" table comes from the same
 * demoAnswer engine the chat uses — the page can never disagree with the chat.
 */

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const dept = departmentBySlug(params.slug);
  if (!dept) return { title: "Monza AI" };
  return { title: `${dept.label} — Monza AI`, description: dept.blurb };
}

/* --- icons: the same drawings as the welcome cards, a size up --------------- */
/* Copied from ChatClient's ConnectorIcon so a card and its page match. */

function DeptIcon({ k }: { k: RecommendedChat["key"] }) {
  const common = {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (k) {
    case "crm":
      return (
        <svg {...common}>
          <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
          <circle cx="10" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "installments":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      );
    case "garage":
      return (
        <svg {...common}>
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      );
    case "inventory":
      return (
        <svg {...common}>
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
      );
    case "finance":
      return (
        <svg {...common}>
          <line x1="12" y1="20" x2="12" y2="10" />
          <line x1="18" y1="20" x2="18" y2="4" />
          <line x1="6" y1="20" x2="6" y2="16" />
        </svg>
      );
  }
}

function ArrowGlyph() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

function BackGlyph() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

/* --- the page --------------------------------------------------------------- */

export const dynamic = "force-dynamic";

export default function DepartmentPage({ params }: { params: { slug: string } }) {
  const dept = departmentBySlug(params.slug);
  if (!dept) notFound();

  // Demo figures belong to demo mode ONLY. Once the CRM is configured this
  // page must never show invented numbers under a note claiming nothing is
  // connected — it points at the chat instead until live views exist.
  const demo = !(
    process.env.NEXT_PUBLIC_CRM_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_CRM_SUPABASE_ANON_KEY
  );
  const glance = demo ? demoAnswer(dept.flagship) : null;
  const table = glance?.tables[0];

  return (
    <div className="dept-page">
      <div className="dept-wrap">
        <Link className="dept-back" href="/chat">
          <BackGlyph />
          Back to chat
        </Link>

        <header className="dept-head">
          <span className="dept-icon">
            <DeptIcon k={dept.key} />
          </span>
          <div>
            <h1 className="h1">{dept.label}</h1>
            <p className="lede">{dept.blurb}</p>
          </div>
        </header>

        {dept.slug === "installments-payments" && (
          <div className="dept-qs" aria-label="Payment tracker">
            <Link className="dept-q" href="/departments/installments-payments/tracker">
              <span className="grow">
                <span className="h2" style={{ display: "block" }}>
                  Payment tracker
                </span>
                <span className="cap">
                  Track this month&apos;s installments, tick off payments, and send clients
                  their messages.
                </span>
              </span>
              <ArrowGlyph />
            </Link>
          </div>
        )}

        <section className="dept-section" aria-label="Ask about this">
          <h2 className="h2">Ask about this</h2>
          <p className="dept-hint">
            Answers open in the chat, and every answer shows which systems were checked.
          </p>
          <div className="dept-qs">
            {dept.questions.map((q) => (
              <Link key={q} className="dept-q" href={`/chat?ask=${encodeURIComponent(q)}`}>
                <span className="grow">{q}</span>
                <ArrowGlyph />
              </Link>
            ))}
          </div>
        </section>

        {table && (
          <section className="dept-section" aria-label="At a glance">
            <h2 className="h2">At a glance</h2>
            <DataTable table={table} />
          </section>
        )}

        {demo ? (
          <div className="note">Example data — not connected to the Monza systems yet.</div>
        ) : (
          <div className="note">
            Ask in the chat for live numbers — every answer shows which systems were checked.
          </div>
        )}
      </div>
    </div>
  );
}
