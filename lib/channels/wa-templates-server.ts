/** WhatsApp reply templates (migration 031) — SERVER ONLY: the list, and an admin's change. */

import { channelDb } from "@/lib/channels/store";
import { blanksOf, templateProblem, type ReplyTemplate } from "@/lib/channels/wa-templates";

export async function listReplyTemplates(enabledOnly: boolean): Promise<ReplyTemplate[] | null> {
  const sb = channelDb();
  if (!sb) return null;
  let q = sb.from("wa_reply_templates").select("name, language, label, body, params, enabled").order("label");
  if (enabledOnly) q = q.eq("enabled", true);
  const { data, error } = await q;
  return error ? null : ((data ?? []) as ReplyTemplate[]);
}

export async function readReplyTemplate(name: string): Promise<ReplyTemplate | null> {
  const sb = channelDb();
  if (!sb) return null;
  const { data } = await sb.from("wa_reply_templates").select("name, language, label, body, params, enabled").eq("name", name).maybeSingle();
  return (data as ReplyTemplate | null) ?? null;
}

export async function saveReplyTemplate(by: { id: string; name: string }, t: { name: string; language: string; label: string; body: string; enabled: boolean }): Promise<{ ok: true } | { ok: false; problem: string }> {
  const problem = templateProblem(t);
  if (problem) return { ok: false, problem };
  const sb = channelDb();
  if (!sb) return { ok: false, problem: "The database is not reachable here." };
  const { error } = await sb.from("wa_reply_templates").upsert(
    {
      name: t.name,
      language: t.language,
      label: t.label.trim().slice(0, 80),
      body: t.body.trim().slice(0, 1024),
      params: blanksOf(t.body).count,
      enabled: t.enabled,
      updated_by: by.id,
      updated_by_name: by.name.slice(0, 120),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "name" }
  );
  return error ? { ok: false, problem: "It could not be saved just now." } : { ok: true };
}
