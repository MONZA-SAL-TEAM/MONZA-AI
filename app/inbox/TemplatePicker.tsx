"use client";

/**
 * After WhatsApp's 24-hour window: pick an approved template, fill its blanks, see exactly what goes, press Send
 * (Samer, 2026-10-20: "reply to messages even after 24 hours"). WhatsApp charges for each one — said on the button.
 * The list is the admin's (Team & access → WhatsApp templates); the server checks everything again.
 */

import { useEffect, useState } from "react";
import { renderTemplate, type ReplyTemplate } from "@/lib/channels/wa-templates";

export default function TemplatePicker({ conversationId, onSent, onNote }: { conversationId: string; onSent: () => void; onNote: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<ReplyTemplate[] | null>(null);
  const [chosen, setChosen] = useState<string>("");
  const [params, setParams] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open || list) return;
    fetch("/api/channels/templates", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { templates?: ReplyTemplate[] } | null) => setList(b?.templates ?? []))
      .catch(() => setList([]));
  }, [open, list]);

  const t = list?.find((x) => x.name === chosen) ?? null;
  const filled = t ? renderTemplate(t.body, params) : "";

  async function send() {
    if (!t) return;
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch("/api/channels/templates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId, name: t.name, params }) });
      const b = (await res.json().catch(() => null)) as { ok?: boolean; delivered?: boolean; message?: string } | null;
      if (res.ok && b?.delivered) {
        setOpen(false);
        setChosen("");
        setParams([]);
        onNote("Template sent.");
        onSent();
      } else setProblem(b?.message ?? `The server answered ${res.status}.`);
    } catch {
      setProblem("Could not reach Monza AI — nothing was sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="ibx-btn" onClick={() => setOpen(true)} title="WhatsApp only delivers an approved template after 24 hours. Each one is charged by WhatsApp.">
        Send a template (paid)
      </button>
      {open && (
        <div className="ibx-sheet" role="dialog" aria-modal="true" aria-label="Send a WhatsApp template" onClick={() => !busy && setOpen(false)}>
          <div className="ibx-sheet-card" onClick={(e) => e.stopPropagation()}>
            <div className="ibx-sheet-head">
              <h3>Send a WhatsApp template</h3>
              <button type="button" className="ibx-icon-btn" aria-label="Cancel" disabled={busy} onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            {list === null ? (
              <p className="ibx-sheet-problem">Loading…</p>
            ) : list.length === 0 ? (
              <p className="ibx-sheet-problem">
                No template is listed yet. A template is approved in WhatsApp Manager first; an admin then adds it in Team &amp; access → WhatsApp templates.
              </p>
            ) : (
              <>
                <select
                  className="ibx-sheet-caption"
                  value={chosen}
                  onChange={(e) => {
                    setChosen(e.target.value);
                    const next = list.find((x) => x.name === e.target.value);
                    setParams(Array.from({ length: next?.params ?? 0 }, () => ""));
                  }}
                  aria-label="Template"
                >
                  <option value="">Choose a template…</option>
                  {list.map((x) => (
                    <option key={x.name} value={x.name}>
                      {x.label}
                    </option>
                  ))}
                </select>
                {t &&
                  params.map((p, i) => (
                    <input
                      key={i}
                      className="ibx-sheet-caption"
                      value={p}
                      maxLength={900}
                      placeholder={`Blank {{${i + 1}}}`}
                      onChange={(e) => setParams((list) => list.map((v, j) => (j === i ? e.target.value : v)))}
                      aria-label={`Blank ${i + 1}`}
                    />
                  ))}
                {t && (
                  <p className="ibx-sheet-preview-text" dir="auto">
                    {filled}
                  </p>
                )}
              </>
            )}
            {problem && (
              <p className="ibx-sheet-problem" role="alert">
                {problem}
              </p>
            )}
            <div className="ibx-sheet-actions">
              <span className="ibx-sheet-size">Charged by WhatsApp</span>
              <button type="button" className="ibx-btn" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" className="ibx-send" disabled={busy || !t || params.some((p) => !p.trim())} onClick={() => void send()}>
                {busy ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
