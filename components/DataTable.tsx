/**
 * One answer table, rendered exactly from the contract's AnswerTable shape:
 * a plain-words title, then a real <table>. Number columns are detected from
 * the data and right-aligned with tabular numerals; everything else stays
 * left-aligned. On small screens the table scrolls horizontally inside its
 * own container — the page never scrolls sideways.
 *
 * Styling comes from the .dtable* classes in app/globals.css, which are built
 * on the theme tokens, so light and dark both work.
 */

import type { AnswerTable } from "@/lib/chat/contract";

type Cell = string | number | null;

/** true → numeric, false → not numeric, null → empty (doesn't vote). */
function looksNumeric(v: Cell): boolean | null {
  if (v === null) return null;
  if (typeof v === "number") return true;
  const t = v.trim();
  if (t === "" || t === "—" || t === "-") return null;
  // "$2,000", "1,250.50", "-3", "(120)", "12%", "62,500 USD"
  return /^\(?[-+]?[$€£]?\s?\d[\d,.\s]*\)?\s?(%|USD|LBP)?$/i.test(t);
}

function isNumericColumn(rows: Cell[][], col: number): boolean {
  let sawNumber = false;
  for (const row of rows) {
    const verdict = looksNumeric(row[col] ?? null);
    if (verdict === false) return false;
    if (verdict === true) sawNumber = true;
  }
  return sawNumber;
}

function cellText(v: Cell): string {
  if (v === null) return "—";
  if (typeof v === "number") {
    // Deterministic locale: no server/client hydration drift.
    return Number.isInteger(v)
      ? v.toLocaleString("en-US")
      : v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  return v;
}

export default function DataTable({ table }: { table: AnswerTable }) {
  if (table.columns.length === 0 || table.rows.length === 0) return null;
  const numeric = table.columns.map((_, c) => isNumericColumn(table.rows, c));

  return (
    <div className="dtable-wrap">
      <p className="dtable-title">{table.title}</p>
      <div className="dtable-scroll" role="region" aria-label={table.title} tabIndex={0}>
        <table className="dtable">
          <thead>
            <tr>
              {table.columns.map((col, c) => (
                <th key={c} className={numeric[c] ? "num" : undefined} scope="col">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r}>
                {table.columns.map((_, c) => {
                  const v = row[c] ?? null;
                  const cls =
                    (numeric[c] ? "num" : "") + (v === null ? (numeric[c] ? " null" : "null") : "");
                  return (
                    <td key={c} className={cls === "" ? undefined : cls}>
                      {cellText(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
