/**
 * Reading the real people for /customers — SERVER ONLY (it holds the service
 * client; there is no `import "server-only"` guard because that package is not
 * a dependency here, exactly as in lib/channels/store.ts). The shaping is pure and lives in lib/leads/people.ts.
 *
 * Reads MONZA AI's own tables, never the CRM, and never a message's words:
 * conversations, leads, first touches, car interests and open sales alerts.
 */

import { channelDb } from "@/lib/channels/store";
import { buildPeople, type PeopleRows, type Person } from "@/lib/leads/people";

const PAGE = 1000;

async function all<T>(read: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 20_000; from += PAGE) {
    const { data, error } = await read(from, from + PAGE - 1);
    if (error) throw error;
    const rows = Array.isArray(data) ? (data as T[]) : [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * The real people, or null when MONZA AI's own database is not reachable here
 * (a local preview without keys) — the screen then says so; it never invents.
 */
export async function listPeople(): Promise<Person[] | null> {
  const sb = channelDb();
  if (!sb) return null;
  try {
    const [conversations, accounts, leads, leadConversations, touchpoints, interests, alerts] = await Promise.all([
      all<PeopleRows["conversations"][number]>((f, t) =>
        sb.from("channel_conversations").select("id, account_id, brand, peer_external_id, peer_display, last_message_at, last_inbound_at, unread_count, created_at").order("last_message_at", { ascending: false, nullsFirst: false }).range(f, t)
      ),
      all<PeopleRows["accounts"][number]>((f, t) => sb.from("channel_accounts").select("id, channel").range(f, t)),
      all<PeopleRows["leads"][number]>((f, t) => sb.from("leads").select("id, display_name, phone, first_seen_at, last_seen_at").range(f, t)),
      all<PeopleRows["leadConversations"][number]>((f, t) => sb.from("lead_conversations").select("lead_id, conversation_id").range(f, t)),
      all<PeopleRows["touchpoints"][number]>((f, t) => sb.from("lead_touchpoints").select("lead_id, source_kind, source_ref, headline, occurred_at").range(f, t)),
      all<PeopleRows["interests"][number]>((f, t) => sb.from("lead_interests").select("lead_id, car_key, mention_count").range(f, t)),
      all<PeopleRows["alerts"][number]>((f, t) => sb.from("sales_alerts").select("thread_id, kind, reason, created_at").eq("status", "open").range(f, t)),
    ]);
    return buildPeople({ conversations, accounts, leads, leadConversations, touchpoints, interests, alerts });
  } catch (e) {
    console.error("[people] reading MONZA AI's own records failed:", e instanceof Error ? e.message : "unknown error");
    return null;
  }
}
