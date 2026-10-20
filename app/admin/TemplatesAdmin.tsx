"use client";

/**
 * WhatsApp templates staff may send after the 24-hour window (migration 031). A template is created and approved
 * in WhatsApp Manager first; here an admin lists it by its exact name and language, with its words, so staff
 * see what goes out. Switching one off hides it from the inbox.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { blanksOf, type ReplyTemplate } from "@/lib/channels/wa-templates";

export default function TemplatesAdmin({ templates }: { templates: ReplyTemplate[] }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", language: "en", label: "", body: "" });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function save(t: { name: string; language: string; label: string; body: string; enabled: boolean }, clear: boolean) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/templates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(t) });
      const b = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      setNote(b?.message ?? `The server answered ${res.status}.`);
      if (res.ok && b?.ok) {
        if (clear) setForm({ name: "", language: "en", label: "", body: "" });
        router.refresh();
      }
    } catch {
      setNote("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const blanks = blanksOf(form.body);
  return (
    <section className="ins-panel">
      <h2 className="ins-h2">WhatsApp templates — replying after 24 hours</h2>
      <p className="ins-known">
        WhatsApp delivers only an approved template to someone who has not written in 24 hours, and charges for each. Create and get the template
        approved in WhatsApp Manager first, then list it here with its exact name, language and words ({"{{1}}"}, {"{{2}}"}… for the blanks).
      </p>
      {templates.length > 0 && (
        <div className="ins-table-wrap">
          <table className="ins-table">
            <thead>
              <tr>
                <th scope="col">Shown to staff as</th>
                <th scope="col">Name at WhatsApp</th>
                <th scope="col">Language</th>
                <th scope="col">Words</th>
                <th scope="col">In the inbox</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.name}>
                  <th scope="row">{t.label}</th>
                  <td>{t.name}</td>
                  <td>{t.language}</td>
                  <td className="ins-wrap" dir="auto">{t.body}</td>
                  <td>
                    <button type="button" className="btn quiet" disabled={busy} onClick={() => void save({ ...t, enabled: !t.enabled }, false)}>
                      {t.enabled ? "On — switch off" : "Off — switch on"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="ins-lab-grid">
        <label className="ins-lab-field">
          <span className="cap">Shown to staff as</span>
          <input value={form.label} maxLength={80} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Follow-up after a few days" />
        </label>
        <label className="ins-lab-field">
          <span className="cap">Name at WhatsApp (exact)</span>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase() })} placeholder="follow_up_1" />
        </label>
        <label className="ins-lab-field">
          <span className="cap">Language code</span>
          <input value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} placeholder="en" />
        </label>
      </div>
      <label className="ins-lab-field">
        <span className="cap">Its words, exactly as approved</span>
        <textarea rows={3} maxLength={1024} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Hello {{1}}, following up on your question about the {{2}}…" />
      </label>
      <p className="ins-known">{blanks.ok ? `${blanks.count} blank${blanks.count === 1 ? "" : "s"} to fill when sending.` : "The blanks must be {{1}}, {{2}}… in order."}</p>
      <div className="rowcard-actions">
        <button type="button" className="btn primary" disabled={busy || !form.name || !form.label || !form.body} onClick={() => void save({ ...form, enabled: true }, true)}>
          Add the template
        </button>
        {note && (
          <span className="ins-note" role="status">
            {note}
          </span>
        )}
      </div>
    </section>
  );
}
