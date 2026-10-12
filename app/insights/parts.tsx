/**
 * Shared pieces of the Insights pages: the section links, bar lists whose every count opens the
 * Research Lab, and the weekly columns. Plain components (no state), usable from server and client.
 */

import Link from "next/link";
import type { LinkedCount } from "@/lib/insights/analysis";
import { labHref } from "@/lib/insights/query";

const SECTIONS: ReadonlyArray<[string, string]> = [
  ["/insights", "Overview"],
  ["/insights/customers", "Customers & leads"],
  ["/insights/clients", "All clients"],
  ["/insights/models", "Models"],
  ["/insights/colours", "Colours"],
  ["/insights/language", "Vehicle language"],
  ["/insights/conversations", "Conversations"],
  ["/insights/channels", "Channels"],
  ["/insights/team", "Team"],
  ["/insights/lab", "Research Lab"],
  ["/insights/quality", "Data quality"],
  ["/insights/connections", "Connections & imports"],
];

export function InsightsNav({ current }: { current: string }) {
  return (
    <nav className="chips ins-nav" aria-label="Insights sections">
      {SECTIONS.map(([href, label]) => (
        <Link key={href} className="chip" aria-pressed={current === href} href={href}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

/** Bars, each opening the people it counts in the Research Lab. `of` turns n into a share of who said it. */
export function LinkedBars({ items, title, of, limit = 12 }: { items: readonly LinkedCount[]; title: string; of?: number; limit?: number }) {
  if (items.length === 0) return <p className="ins-empty">Nobody yet.</p>;
  const max = Math.max(1, ...items.map((i) => i.n));
  return (
    <ul className="ins-bars" aria-label={title}>
      {items.slice(0, limit).map((i) => (
        <li key={i.key} title={`${i.label}: ${i.n} ${i.n === 1 ? "person" : "people"} — open them in the Research Lab`}>
          <Link className="ins-bar-label ins-bar-link" href={labHref(i.q)}>
            {i.label}
          </Link>
          <span className="ins-bar-track">
            <span className="ins-bar-fill" style={{ width: `${Math.max(2, (i.n / max) * 100)}%` }} />
          </span>
          <Link className="ins-bar-value ins-bar-link" href={labHref(i.q)}>
            {i.n}
            {of ? <span className="ins-known"> {Math.round((i.n / of) * 100)}%</span> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function Weekly({ values, title }: { values: readonly number[]; title: string }) {
  const max = Math.max(1, ...values);
  const W = 360;
  const H = 80;
  const gap = 4;
  const bw = (W - gap * (values.length - 1)) / values.length;
  return (
    <figure className="ins-columns">
      <svg viewBox={`0 0 ${W} ${H + 4}`} role="img" aria-label={`${title}: ${values.join(", ")}`}>
        <line x1="0" y1={H + 0.5} x2={W} y2={H + 0.5} className="ins-axis" />
        {values.map((v, i) => {
          const h = v === 0 ? 0 : Math.max(3, (v / max) * (H - 8));
          return (
            <rect key={i} x={i * (bw + gap)} y={H - h} width={bw} height={h} rx="3" className="ins-col">
              <title>{`${values.length - 1 - i === 0 ? "This week" : `${values.length - 1 - i} weeks ago`}: ${v}`}</title>
            </rect>
          );
        })}
      </svg>
      <figcaption>{title}, per week, last {values.length} weeks</figcaption>
    </figure>
  );
}

export function PeriodChips({ path, days, extra = "" }: { path: string; days: number; extra?: string }) {
  const PERIODS: ReadonlyArray<[number, string]> = [
    [30, "30 days"],
    [90, "90 days"],
    [365, "12 months"],
    [0, "All time"],
  ];
  return (
    <div className="chips" role="group" aria-label="Period">
      {PERIODS.map(([d, label]) => (
        <Link key={d} className="chip" aria-pressed={days === d} href={`${path}?days=${d}${extra}`}>
          {label}
        </Link>
      ))}
    </div>
  );
}

export function parseDays(raw: unknown, fallback = 90): number {
  const n = Number(typeof raw === "string" ? raw : fallback);
  return [30, 90, 365, 0].includes(n) ? n : fallback;
}

/** Bars that are NOT links — for counts the Research Lab cannot list exactly yet. */
export function PlainBars({ items, title, of }: { items: readonly { key: string; label: string; n: number }[]; title: string; of?: number }) {
  if (items.length === 0) return <p className="ins-empty">Nobody yet.</p>;
  const max = Math.max(1, ...items.map((i) => i.n));
  return (
    <ul className="ins-bars" aria-label={title}>
      {items.map((i) => (
        <li key={i.key} title={`${i.label}: ${i.n}`}>
          <span className="ins-bar-label">{i.label}</span>
          <span className="ins-bar-track">
            <span className="ins-bar-fill" style={{ width: `${Math.max(2, (i.n / max) * 100)}%` }} />
          </span>
          <span className="ins-bar-value">
            {i.n}
            {of ? <span className="ins-known"> {Math.round((i.n / of) * 100)}%</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
