"use client";

/**
 * "Take this lead" (Samer, 2026-10-12). Shows who owns the open chat; sales take an unowned lead and
 * release their own; managers and the owner also assign it to someone. Two people pressing Take at the
 * same moment: one wins, the other is told who (the server's 409). Rules: lib/leads/ownership.ts.
 */

import { useEffect, useState } from "react";

interface Owner {
  id: string;
  name: string | null;
}
interface OwnerState {
  owner: Owner | null;
  me: Owner;
  canTake: boolean;
  canRelease: boolean;
  canAssign: boolean;
  staff: Owner[];
}

export default function OwnerChip({ threadId, onChange }: { threadId: string; onChange?: (owner: Owner | null) => void }) {
  const [state, setState] = useState<OwnerState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setState(null);
    setNote(null);
    fetch(`/api/conversations/owner?thread=${encodeURIComponent(threadId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: (OwnerState & { ok?: boolean }) | null) => {
        if (alive && b?.ok) setState(b);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [threadId]);

  async function act(action: "take" | "release" | "assign", to?: Owner) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/conversations/owner", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ thread: threadId, action, to }),
      });
      const b = (await res.json().catch(() => null)) as { ok?: boolean; owner?: Owner | null; message?: string } | null;
      const owner = b?.owner ?? null;
      if (!res.ok || !b?.ok) setNote(b?.message ?? "Could not change the owner just now.");
      setState((s) =>
        s ? { ...s, owner, canTake: !owner, canRelease: Boolean(owner) && (owner?.id === s.me.id || s.canAssign) } : s
      );
      onChange?.(owner);
    } catch {
      setNote("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;
  const mine = state.owner?.id === state.me.id;
  return (
    <div className="ibx-owner" role="group" aria-label="Lead owner">
      <span className="ibx-owner-name" data-owned={Boolean(state.owner)} title={state.owner ? `Owned by ${state.owner.name ?? "someone"}` : "Nobody owns this lead yet"}>
        {state.owner ? (mine ? "Your lead" : state.owner.name ?? "Owned") : "Unassigned"}
      </span>
      {state.canTake && (
        <button type="button" className="ibx-owner-btn" disabled={busy} onClick={() => void act("take")}>
          Take this lead
        </button>
      )}
      {state.canRelease && (
        <button type="button" className="ibx-owner-btn quiet" disabled={busy} onClick={() => void act("release")}>
          Release
        </button>
      )}
      {state.canAssign && state.staff.length > 0 && (
        <select
          className="ibx-owner-select"
          aria-label="Assign to"
          value=""
          disabled={busy}
          onChange={(e) => {
            const to = state.staff.find((s) => s.id === e.target.value);
            if (to) void act("assign", to);
          }}
        >
          <option value="">Assign to…</option>
          {state.staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
      {note && (
        <span className="ibx-owner-note" role="status">
          {note}
        </span>
      )}
    </div>
  );
}
