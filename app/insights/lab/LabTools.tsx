"use client";

/**
 * The Lab's actions: download what is shown as CSV, save the current question as a study, delete a
 * saved study, and rebuild the per-person summaries now.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { labCsv, labTable } from "@/lib/insights/lab";
import { xlsxBytes } from "@/lib/insights/xlsx";
import type { LabPerson } from "@/lib/insights/people-server";

export default function LabTools({ people, query }: { people: LabPerson[]; query: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState<string | null>(null);

  function download() {
    const blob = new Blob(["﻿" + labCsv(people)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `monza-ai-research-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function downloadExcel() {
    const t = labTable(people);
    const bytes = xlsxBytes("Research Lab", t.header, t.rows);
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `monza-ai-research-${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function call(url: string, init: RequestInit, ok: (b: Record<string, unknown>) => string) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(url, init);
      const b = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      setNote(res.ok && b?.ok ? ok(b) : String(b?.message ?? `The server answered ${res.status}.`));
      router.refresh();
    } catch {
      setNote("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rowcard-actions ins-lab-tools">
      <button type="button" className="btn" onClick={download} disabled={people.length === 0}>
        Download CSV ({people.length})
      </button>
      <button type="button" className="btn" onClick={downloadExcel} disabled={people.length === 0}>
        Download Excel
      </button>
      <form
        className="ins-lab-save"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void call("/api/insights/studies", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, query }) }, () => `Saved “${name.trim()}”.`).then(() => setName(""));
        }}
      >
        <input className="board-search" placeholder="Name this study…" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-label="Study name" />
        <button type="submit" className="btn primary" disabled={busy || !name.trim()}>
          Save study
        </button>
      </form>
      <button type="button" className="btn quiet" disabled={busy} onClick={() => void call("/api/insights/people", { method: "POST" }, (b) => `Rebuilt ${String(b.people ?? 0)} people.`)}>
        Rebuild the summaries now
      </button>
      {note && (
        <span className="ins-note" role="status">
          {note}
        </span>
      )}
    </div>
  );
}

export function DeleteStudy({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn quiet"
      disabled={busy}
      onClick={async () => {
        if (!window.confirm("Delete this saved study? The people are not affected.")) return;
        setBusy(true);
        await fetch(`/api/insights/studies?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
        setBusy(false);
        router.refresh();
      }}
    >
      Delete
    </button>
  );
}
