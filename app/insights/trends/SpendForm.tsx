"use client";

/** A manager types one month's ad spend (USD) for a brand and channel, from the ad account's own figures. */

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SpendForm({ month }: { month: string }) {
  const router = useRouter();
  const [form, setForm] = useState({ month, brand: "voyah", channel: "all", amount: "" });
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/insights/spend", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...form, amount: Number(form.amount) }) });
      const b = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      setNote(res.ok && b?.ok ? "Saved." : (b?.message ?? "Not saved."));
      if (res.ok) router.refresh();
    } catch {
      setNote("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="ins-lab-save" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <input type="month" className="board-search" value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} aria-label="Month" />
      <select className="ibx-owner-select" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} aria-label="Brand">
        <option value="voyah">VOYAH</option>
        <option value="mhero">MHERO</option>
        <option value="monza">Monza S.A.L.</option>
      </select>
      <select className="ibx-owner-select" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} aria-label="Channel">
        <option value="all">All channels</option>
        <option value="whatsapp">WhatsApp ads</option>
        <option value="instagram">Instagram</option>
        <option value="facebook">Facebook</option>
      </select>
      <input className="board-search" inputMode="decimal" placeholder="Amount in $" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} aria-label="Amount in dollars" />
      <button type="submit" className="btn primary" disabled={busy || !form.amount}>
        Save spend
      </button>
      {note && <span className="ins-note">{note}</span>}
    </form>
  );
}
