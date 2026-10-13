"use client";

/**
 * The actions of one account on Connections & Imports. WhatsApp: read the stored history again with the
 * current reader. Instagram / Facebook: count first (reads Meta, writes nothing), read the history (labels
 * only), continue after a pause, or start again. Reading runs ON THE SERVER until it is finished (Samer's
 * audit, 2026-10-13) — this page only starts it and shows where it stands.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

type Body = { ok?: boolean; message?: string; done?: boolean; state?: string; code?: string | null; threads?: number; messages?: number; matchedExisting?: number; signals?: number; conversations?: number; observations?: number };

export default function PipelineActions({ accountId, channel, runState }: { accountId: string; channel: string; runState: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function post(url: string): Promise<Body | null> {
    const res = await fetch(url, { method: "POST" });
    const b = (await res.json().catch(() => null)) as Body | null;
    if (!res.ok || !b?.ok) {
      setNote(b?.message ?? `The server answered ${res.status}.`);
      return null;
    }
    return b;
  }

  /** Start a history read ON THE SERVER, then show where it stands every few seconds while this page is open. */
  async function serverRead(job: string, restart: boolean) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/insights/rebuild?job=${encodeURIComponent(job)}${restart ? "&restart=1" : ""}`, { method: "POST" });
      const b = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      setNote(b?.message ?? `The server answered ${res.status}.`);
      if (!res.ok || !b?.ok) return;
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 5_000));
        const st = await fetch(`/api/insights/rebuild?job=${encodeURIComponent(job)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null) as
          | { reading?: boolean; state?: string; hops?: number; current?: number | null; total?: number | null }
          | null;
        if (!st) {
          setNote("Reading on the server. (This page cannot see its progress right now — sign in again to watch it.)");
          return;
        }
        const pct = st.current !== null && st.current !== undefined && st.total ? ` — ${st.current} of ${st.total} customer messages read with the current rules` : "";
        setNote(`${st.reading ? "Reading on the server" : st.state === "done" ? "Finished" : "Stopped"}${pct}.`);
        if (!st.reading) break;
      }
      router.refresh();
    } catch {
      setNote("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function meta(mode: "dry" | "read" | "restart") {
    if (mode !== "dry") return serverRead(`meta:${accountId}`, mode === "restart");
    setBusy(true);
    setNote(null);
    let total = { threads: 0, messages: 0, matched: 0, signals: 0 };
    try {
      for (let round = 0; round < (mode === "dry" ? 1 : 25); round++) {
        const q = mode === "dry" ? "&dry=1" : mode === "restart" && round === 0 ? "&restart=1" : "";
        const b = await post(`/api/insights/backfill?account=${encodeURIComponent(accountId)}${q}`);
        if (!b) break;
        total = { threads: total.threads + (b.threads ?? 0), messages: total.messages + (b.messages ?? 0), matched: total.matched + (b.matchedExisting ?? 0), signals: total.signals + (b.signals ?? 0) };
        const where = b.state === "done" ? "Finished." : b.state === "unknown" ? `Meta answered with nothing (${b.code}) — unknown, not empty.` : b.code ? `Stopped: ${b.code}.` : "Still reading…";
        setNote(
          mode === "dry"
            ? `Count only (nothing written): ${total.threads} conversations, ${total.messages} messages, ${total.matched} already labelled. ${where}`
            : `${total.threads} conversations, ${total.signals} customer messages labelled. ${where}`
        );
        if (mode === "dry" || b.state !== "running") break;
      }
      if (mode !== "dry") router.refresh();
    } catch {
      setNote("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rowcard-actions">
      {channel === "whatsapp" ? (
        <button type="button" className="btn" disabled={busy} onClick={() => void serverRead("wa", runState === "done" || runState === null)}>
          {busy ? "Reading…" : "Read the stored history again"}
        </button>
      ) : (
        <>
          <button type="button" className="btn" disabled={busy} onClick={() => void meta("dry")}>
            Count first
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void meta("read")}>
            {busy ? "Reading…" : runState === "blocked" || runState === "running" ? "Continue" : runState === "done" ? "Read new chats" : "Read history"}
          </button>
          {runState && runState !== "not_started" && (
            <button type="button" className="btn quiet" disabled={busy} onClick={() => void meta("restart")}>
              Start again
            </button>
          )}
        </>
      )}
      {note && (
        <span className="ins-note" role="status">
          {note}
        </span>
      )}
    </div>
  );
}
