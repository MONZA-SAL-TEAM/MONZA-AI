"use client";

/**
 * The actions of one account on Connections & Imports. WhatsApp: read the stored history again with the
 * current reader. Instagram / Facebook: count first (reads Meta, writes nothing), read the history (labels
 * only), continue after a pause, or start again. Each call reads for under a minute and is called again
 * until it is done or Meta pushes back; the page then reloads its counts.
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

  async function whatsapp() {
    setBusy(true);
    setNote(null);
    let total = { conversations: 0, signals: 0, observations: 0 };
    try {
      for (let round = 0; round < 40; round++) {
        const b = await post(`/api/insights/rebuild${round === 0 ? "?restart=1" : ""}`);
        if (!b) break;
        total = { conversations: total.conversations + (b.conversations ?? 0), signals: total.signals + (b.signals ?? 0), observations: total.observations + (b.observations ?? 0) };
        setNote(`${total.conversations} conversations · ${total.signals} customer messages · ${total.observations} facts${b.done ? " — done." : " — still reading…"}`);
        if (b.done) break;
      }
      router.refresh();
    } catch {
      setNote("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function meta(mode: "dry" | "read" | "restart") {
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
        <button type="button" className="btn" disabled={busy} onClick={() => void whatsapp()}>
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
