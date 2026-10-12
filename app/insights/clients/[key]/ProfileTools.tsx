"use client";

/**
 * A client profile's decisions: record why the lead was lost (a closed list; "clear" withdraws it), join
 * this person with another one, or separate one of their chats. Each is recorded with who and when; the
 * server refuses a merge or split from anyone but a manager or the owner.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LOST_LABEL, LOST_REASONS } from "@/lib/insights/outcomes";

export function LostReason({ person, current }: { person: string; current: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function record(reason: string) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/insights/outcome", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ person, reason }) });
      const b = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      setNote(res.ok && b?.ok ? (reason === "cleared" ? "Cleared." : `Recorded: ${LOST_LABEL[reason]}.`) : (b?.message ?? "Not saved."));
      if (res.ok) router.refresh();
    } catch {
      setNote("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rowcard-actions">
      <select className="ibx-owner-select" disabled={busy} value="" aria-label="Record why this lead was lost" onChange={(e) => e.target.value && void record(e.target.value)}>
        <option value="">{current ? "Change the reason…" : "Record why it was lost…"}</option>
        {LOST_REASONS.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
      {current && (
        <button type="button" className="btn quiet" disabled={busy} onClick={() => void record("cleared")}>
          Not lost — clear
        </button>
      )}
      {note && <span className="ins-note">{note}</span>}
    </div>
  );
}

export function SamePerson({ person }: { person: string }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [found, setFound] = useState<{ key: string; name: string; detail: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function find() {
    setNote(null);
    const res = await fetch(`/api/insights/identity?search=${encodeURIComponent(search)}`, { cache: "no-store" });
    const b = (await res.json().catch(() => null)) as { ok?: boolean; people?: { key: string; name: string; detail: string }[] } | null;
    setFound((b?.people ?? []).filter((p) => p.key !== person));
  }
  async function merge(source: string, name: string) {
    if (!window.confirm(`Join ${name} with this person? Their chats will count as one person. This is recorded and can be separated again.`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/insights/identity", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "merge", target: person, source }) });
      const b = (await res.json().catch(() => null)) as { ok?: boolean; key?: string; message?: string } | null;
      if (res.ok && b?.ok && b.key) router.push(`/insights/clients/${encodeURIComponent(b.key)}`);
      else setNote(b?.message ?? "Not joined.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ins-same">
      <form
        className="ins-lab-save"
        onSubmit={(e) => {
          e.preventDefault();
          if (search.trim().length >= 2) void find();
        }}
      >
        <input className="board-search" placeholder="Same person as… (name or number)" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Find the same person" />
        <button type="submit" className="btn">
          Find
        </button>
      </form>
      {found && found.length === 0 && <p className="ins-empty">Nobody found.</p>}
      {found && found.length > 0 && (
        <ul className="ins-people">
          {found.map((p) => (
            <li key={p.key}>
              {p.name} <span className="ins-known">{p.detail}</span>{" "}
              <button type="button" className="btn quiet" disabled={busy} onClick={() => void merge(p.key, p.name)}>
                Join with this person
              </button>
            </li>
          ))}
        </ul>
      )}
      {note && <span className="ins-note">{note}</span>}
    </div>
  );
}

export function Separate({ conversation }: { conversation: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn quiet"
      disabled={busy}
      onClick={async () => {
        if (!window.confirm("This chat is NOT this person? It becomes a person of its own. This is recorded.")) return;
        setBusy(true);
        const res = await fetch("/api/insights/identity", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "split", conversation }) });
        setBusy(false);
        if (res.ok) router.refresh();
        else window.alert(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? "Not separated.");
      }}
    >
      Not this person
    </button>
  );
}
