"use client";

/** One person's MONZA AI access: a ready-made role, or pages and actions ticked one by one; block; admin. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ACTIONS, PAGES, PRESETS, type PresetKey } from "@/lib/access/access";

interface Setting {
  isAdmin: boolean;
  blocked: boolean;
  preset: string | null;
  pages: string[];
  actions: string[];
}

export default function AccessEditor({ userId, name, email, initial, isSelf }: { userId: string; name: string; email: string | null; initial: Setting | null; isSelf: boolean }) {
  const router = useRouter();
  const [s, setS] = useState<Setting>(initial ?? { isAdmin: false, blocked: false, preset: "custom", pages: PAGES.map((p) => p.key), actions: [] });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const usePreset = (k: string) => {
    if (k in PRESETS) setS({ ...s, preset: k, pages: [...PRESETS[k as PresetKey].pages], actions: [...PRESETS[k as PresetKey].actions] });
    else setS({ ...s, preset: "custom" });
  };
  const toggle = (field: "pages" | "actions", key: string) => {
    const has = s[field].includes(key);
    setS({ ...s, preset: "custom", [field]: has ? s[field].filter((x) => x !== key) : [...s[field], key] });
  };

  async function save(setting: Setting | null) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId, name, email, setting }) });
      const b = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      setNote(b?.message ?? `The server answered ${res.status}.`);
      if (res.ok && b?.ok) router.refresh();
    } catch {
      setNote("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ins-panel">
      <h2 className="ins-h2">Access to MONZA AI</h2>
      {!initial && <p className="ins-known">Not set yet: today their CRM role decides. Saving below puts them under these settings.</p>}
      <div className="ins-lab-grid">
        <label className="ins-lab-field">
          <span className="cap">Role</span>
          <select value={s.preset ?? "custom"} onChange={(e) => usePreset(e.target.value)} disabled={busy || s.isAdmin || s.blocked}>
            {(Object.keys(PRESETS) as PresetKey[]).map((k) => (
              <option key={k} value={k}>
                {PRESETS[k].label}
              </option>
            ))}
            <option value="custom">Custom</option>
          </select>
        </label>
        <label className="ins-lab-check">
          <input type="checkbox" checked={s.isAdmin} disabled={busy || isSelf} onChange={(e) => setS({ ...s, isAdmin: e.target.checked, blocked: e.target.checked ? false : s.blocked })} /> Admin (everything, and this page)
        </label>
        <label className="ins-lab-check">
          <input type="checkbox" checked={s.blocked} disabled={busy || isSelf || s.isAdmin} onChange={(e) => setS({ ...s, blocked: e.target.checked })} /> Block from MONZA AI
        </label>
      </div>
      {s.preset && s.preset in PRESETS && !s.isAdmin && <p className="ins-known">{PRESETS[s.preset as PresetKey].blurb}</p>}

      <fieldset className="ins-dec" disabled={busy || s.isAdmin || s.blocked}>
        <legend className="tile-label">Pages they may open</legend>
        <div className="ins-dec-tools">
          {PAGES.map((p) => (
            <label key={p.key} className="ins-lab-check">
              <input type="checkbox" checked={s.isAdmin || s.pages.includes(p.key)} onChange={() => toggle("pages", p.key)} /> {p.label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="ins-dec" disabled={busy || s.isAdmin || s.blocked}>
        <legend className="tile-label">What they may do</legend>
        <div className="ins-dec-list">
          {ACTIONS.map((a) => (
            <label key={a.key} className="ins-lab-check" title={a.blurb}>
              <input type="checkbox" checked={s.isAdmin || s.actions.includes(a.key)} onChange={() => toggle("actions", a.key)} /> {a.label} <span className="ins-known">— {a.blurb}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="rowcard-actions">
        <button type="button" className="btn primary" disabled={busy} onClick={() => void save(s)}>
          {busy ? "Saving…" : "Save"}
        </button>
        {initial && !isSelf && (
          <button type="button" className="btn quiet" disabled={busy} onClick={() => void save(null)} title="Remove these settings: their CRM role decides again">
            Back to the CRM role
          </button>
        )}
        {note && (
          <span className="ins-note" role="status">
            {note}
          </span>
        )}
      </div>
      {isSelf && <p className="ins-known">This is you: you cannot remove your own admin access or block yourself.</p>}
    </div>
  );
}
