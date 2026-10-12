"use client";

/** One fact's decision buttons: confirm, not this (unknown), or correct the car / the colour. */

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ReviewActions({ id, kind, models, colours }: { id: string; kind: string; models: { value: string; label: string }[]; colours: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function decide(action: "confirm" | "correct" | "mark_unknown", extra: Record<string, string> = {}) {
    setBusy(true);
    try {
      const res = await fetch("/api/insights/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action, ...extra }) });
      const b = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      setDone(res.ok && b?.ok ? (action === "confirm" ? "Confirmed" : action === "correct" ? "Corrected" : "Marked unknown") : (b?.message ?? "Not saved"));
      if (res.ok) router.refresh();
    } catch {
      setDone("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (done) return <span className="ins-note">{done}</span>;
  return (
    <div className="rowcard-actions">
      <button type="button" className="btn" disabled={busy} onClick={() => void decide("confirm")}>
        {kind === "unresolved" ? "Yes, it is this car" : "Correct as it is"}
      </button>
      <button type="button" className="btn quiet" disabled={busy} onClick={() => void decide("mark_unknown")}>
        {kind === "unresolved" ? "Not a car" : "Not right — remove"}
      </button>
      {(kind === "colour" || kind === "unresolved" || kind === "mention") && (
        <select className="ibx-owner-select" disabled={busy} value="" aria-label="The right car" onChange={(e) => e.target.value && void decide("correct", { newModel: e.target.value })}>
          <option value="">The right car is…</option>
          {models.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      )}
      {kind === "colour" && (
        <select className="ibx-owner-select" disabled={busy} value="" aria-label="The right colour" onChange={(e) => e.target.value && void decide("correct", { newValue: e.target.value })}>
          <option value="">The right colour is…</option>
          {colours.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
