"use client";

/** The Lab's two actions: download what is shown as CSV, and rebuild the per-person summaries now. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { labCsv } from "@/lib/insights/lab";
import type { LabPerson } from "@/lib/insights/people-server";

export default function LabTools({ people }: { people: LabPerson[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  function download() {
    const blob = new Blob([labCsv(people)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `monza-ai-research-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function refresh() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/insights/people", { method: "POST" });
      const b = (await res.json().catch(() => null)) as { ok?: boolean; people?: number; message?: string } | null;
      setNote(res.ok && b?.ok ? `Rebuilt ${b.people ?? 0} people.` : (b?.message ?? "Could not rebuild just now."));
      router.refresh();
    } catch {
      setNote("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rowcard-actions">
      <button type="button" className="btn" onClick={download} disabled={people.length === 0}>
        Download CSV
      </button>
      <button type="button" className="btn quiet" onClick={() => void refresh()} disabled={busy}>
        {busy ? "Rebuilding…" : "Rebuild the summaries now"}
      </button>
      {note && <span className="ins-note">{note}</span>}
    </div>
  );
}
