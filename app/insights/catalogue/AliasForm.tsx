"use client";

/** Approve a new word for a car, or reject one the reader should stop using (insights only). */

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AliasForm({ models, initial }: { models: { value: string; label: string }[]; initial?: { alias: string; model: string } }) {
  const router = useRouter();
  const [alias, setAlias] = useState(initial?.alias ?? "");
  const [model, setModel] = useState(initial?.model ?? models[0]?.value ?? "");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function decide(status: "approved" | "rejected") {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/insights/aliases", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alias, model, status }) });
      const b = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      setNote(res.ok && b?.ok ? `${status === "approved" ? "Approved" : "Rejected"} “${alias}”. Re-read the history for past messages to follow.` : (b?.message ?? "Not saved."));
      if (res.ok) {
        setAlias("");
        router.refresh();
      }
    } catch {
      setNote("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="ins-lab-save" onSubmit={(e) => e.preventDefault()}>
      <input className="board-search" dir="auto" placeholder="A word customers use…" value={alias} maxLength={40} onChange={(e) => setAlias(e.target.value)} aria-label="Word" />
      <select className="ibx-owner-select" value={model} onChange={(e) => setModel(e.target.value)} aria-label="Car">
        {models.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      <button type="button" className="btn primary" disabled={busy || alias.trim().length < 2} onClick={() => void decide("approved")}>
        Approve
      </button>
      <button type="button" className="btn quiet" disabled={busy || alias.trim().length < 2} onClick={() => void decide("rejected")}>
        Reject
      </button>
      {note && <span className="ins-note">{note}</span>}
    </form>
  );
}
