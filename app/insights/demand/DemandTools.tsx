"use client";

/** Store the record now, and download what is shown (Excel or CSV). No client data is in either. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { xlsxBytes } from "@/lib/insights/xlsx";

export default function DemandTools({ header, rows, name }: { header: string[]; rows: (string | number | null)[][]; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const save = (blob: Blob, ext: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `monza-ai-demand-${name}-${new Date().toISOString().slice(0, 10)}.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  async function store() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/insights/demand?scope=all", { method: "POST" });
      const b = (await res.json().catch(() => null)) as { ok?: boolean; days?: number; months?: number; message?: string } | null;
      setNote(res.ok && b?.ok ? `Stored ${b.days} days and ${b.months} months.` : (b?.message ?? "Not stored."));
      router.refresh();
    } catch {
      setNote("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rowcard-actions">
      <button type="button" className="btn" disabled={rows.length === 0} onClick={() => save(new Blob([xlsxBytes("Demand", header, rows).buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "xlsx")}>
        Download Excel
      </button>
      <button
        type="button"
        className="btn quiet"
        disabled={rows.length === 0}
        onClick={() => {
          const cell = (v: string | number | null) => {
            const s = v === null ? "" : String(v);
            const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
            return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
          };
          save(new Blob(["﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }), "csv");
        }}
      >
        Download CSV
      </button>
      <button type="button" className="btn quiet" disabled={busy} onClick={() => void store()}>
        {busy ? "Storing…" : "Store the record now"}
      </button>
      {note && <span className="ins-note">{note}</span>}
    </div>
  );
}
