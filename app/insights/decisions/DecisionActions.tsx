"use client";

/** One Decision Center item's buttons: assign, acknowledge, escalate, resolve, dismiss — or reopen. */

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DecisionActions({ id, live, staff, assignedTo, personItem }: { id: string; live: boolean; staff: { id: string; name: string | null }[]; assignedTo: string | null; personItem: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [to, setTo] = useState(assignedTo ?? "");

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/insights/decisions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action, ...extra }) });
      const b = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; lead?: string | null } | null;
      if (!res.ok || !b?.ok) setNote(b?.message ?? `The server answered ${res.status}.`);
      else {
        if (b.lead) setNote(b.lead);
        router.refresh();
      }
    } catch {
      setNote("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (!live) {
    return (
      <div className="ins-dec-tools">
        <button type="button" className="btn quiet" disabled={busy} onClick={() => void act("reopen")}>
          Reopen
        </button>
        {note && <span className="ins-note" role="status">{note}</span>}
      </div>
    );
  }
  return (
    <div className="ins-dec-tools">
      {staff.length > 0 && (
        <>
          <select aria-label="Assign to" value={to} onChange={(e) => setTo(e.target.value)} disabled={busy}>
            <option value="">Assign to…</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name ?? "Staff"}
              </option>
            ))}
          </select>
          <button type="button" className="btn" disabled={busy || !to || to === assignedTo} onClick={() => void act("assign", { to })} title={personItem ? "Also makes them the lead's owner" : undefined}>
            Assign
          </button>
        </>
      )}
      <button type="button" className="btn quiet" disabled={busy} onClick={() => void act("acknowledge")}>
        Seen
      </button>
      <button type="button" className="btn quiet" disabled={busy} onClick={() => void act("escalate")}>
        Escalate
      </button>
      <button type="button" className="btn primary" disabled={busy} onClick={() => void act("resolve")}>
        Done
      </button>
      <button type="button" className="btn quiet" disabled={busy} onClick={() => void act("dismiss")} title="Not needed — it will not come back for 7 days">
        Dismiss
      </button>
      {note && <span className="ins-note" role="status">{note}</span>}
    </div>
  );
}
