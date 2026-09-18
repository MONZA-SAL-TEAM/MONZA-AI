/**
 * THE PEOPLE MONZA IS TALKING TO — the real list behind /customers.
 *
 * Until 2026-09-18 that screen showed ten invented example people, because the
 * only "customer" source was the demo one (the CRM is not connected). But
 * MONZA AI has real people of its own: everyone with a conversation in
 * `channel_conversations` (WhatsApp today), the lead the webhook recorded for
 * them (`leads`: the name and number WhatsApp handed over), where they came
 * from (`lead_touchpoints`), the cars they named (`lead_interests`) and
 * whether the sales bot marked them for a person (`sales_alerts`).
 *
 * What this is NOT: a CRM. Nothing here can be edited, no message text is read
 * or returned, and cars / payment plans stay absent until the CRM is connected
 * — this screen says so instead of inventing them.
 *
 * This file is PURE (the browser imports it for search, the summary and the
 * export); the database read is lib/leads/people-server.ts.
 *
 * A person is a LEAD when the webhook made one, otherwise the conversation
 * itself (a chat staff started from the phone has no lead). Conversations of
 * the same lead are one person.
 */

import { encodeThreadId } from "@/lib/channels/live-map";
import { MONZA_KNOWLEDGE, modelByCatalogueId } from "@/lib/wasales/knowledge";
import { isAutoLinkable, normalizeLebanesePhone } from "@/lib/leads/phone";

export type PersonChannel = "whatsapp" | "instagram" | "facebook";

export interface PersonThread {
  threadId: string;
  channel: PersonChannel;
  brand: string;
  /** ISO; null when nothing has been exchanged yet. */
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  unread: number;
}

export interface PersonAlert {
  kind: string;
  reason: string | null;
  createdAt: string;
  threadId: string;
}

export interface Person {
  id: string;
  name: string;
  /** Digits only; null when unknown (Instagram and Facebook never give one). */
  phone: string | null;
  threads: PersonThread[];
  /** "Ad click", "Story reply", … — "Not tracked" when we do not know. Never "organic". */
  source: string;
  /** The ad's or post's headline, when Meta sent one ("Voyah COURAGE"). */
  sourceDetail: string | null;
  /** Meta's id of that ad or post, so two ads with one headline stay apart. */
  sourceRef: string | null;
  /** Cars named in the chat, as Monza writes them. */
  interests: string[];
  alerts: PersonAlert[];
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  /** Their record in the CRM, when the staff member looking may see it. Read live, never stored. */
  crm: CrmRecord | null;
}

/** A customer as the CRM holds them (its words, its figures — MONZA AI keeps no copy). */
export interface CrmRecord {
  customerId: string;
  name: string;
  phone: string | null;
  email: string | null;
  /** "lead_source", in the CRM's own words. */
  leadSource: string | null;
  /** ISO date the CRM record was created. */
  since: string | null;
  /** "VOYAH Free 2026 · plate 123456 · delivered" */
  cars: string[];
  activePlans: number;
}

/* ── Rows, exactly as the tables give them ───────────────────────────────── */

export interface PeopleRows {
  conversations: { id: string; account_id: string; brand: string; peer_external_id: string | null; peer_display: string | null; last_message_at: string | null; last_inbound_at: string | null; unread_count: number | null; created_at: string | null }[];
  accounts: { id: string; channel: string }[];
  leads: { id: string; display_name: string | null; phone: string | null; first_seen_at: string | null; last_seen_at: string | null }[];
  leadConversations: { lead_id: string; conversation_id: string }[];
  touchpoints: { lead_id: string; source_kind: string | null; source_ref?: string | null; headline: string | null; occurred_at: string | null }[];
  interests: { lead_id: string; car_key: string | null; mention_count: number | null }[];
  alerts: { thread_id: string | null; kind: string; reason: string | null; created_at: string }[];
}

const SOURCE_LABEL: Readonly<Record<string, string>> = {
  ad_click: "Ad click",
  story_reply: "Story reply",
  story_mention: "Story mention",
  post_share: "Shared post",
  referral_link: "Link",
  get_started: "Get started",
  // "direct" means WE DO NOT KNOW (CLAUDE.md, leads): never "organic", never "word of mouth".
  direct: "Not tracked",
};

function channelOf(value: string | undefined): PersonChannel {
  return value === "instagram" || value === "facebook" ? value : "whatsapp";
}

function digits(value: string | null | undefined): string | null {
  const d = (value ?? "").replace(/\D/g, "");
  return d.length >= 7 && d.length <= 15 ? d : null;
}

function latest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function earliest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

/** The people, newest activity first. Pure: the rows in, the list out. */
export function buildPeople(rows: PeopleRows): Person[] {
  const channelByAccount = new Map(rows.accounts.map((a) => [a.id, channelOf(a.channel)]));
  const leadByConversation = new Map(rows.leadConversations.map((lc) => [lc.conversation_id, lc.lead_id]));
  const leadById = new Map(rows.leads.map((l) => [l.id, l]));
  const alertsByThread = new Map<string, PersonAlert[]>();
  for (const a of rows.alerts) {
    if (!a.thread_id) continue;
    const list = alertsByThread.get(a.thread_id) ?? [];
    list.push({ kind: a.kind, reason: a.reason, createdAt: a.created_at, threadId: a.thread_id });
    alertsByThread.set(a.thread_id, list);
  }

  const people = new Map<string, Person>();
  for (const c of rows.conversations) {
    const leadId = leadByConversation.get(c.id) ?? null;
    const lead = leadId ? leadById.get(leadId) ?? null : null;
    const key = lead ? `lead:${lead.id}` : `chat:${c.id}`;
    const channel = channelByAccount.get(c.account_id) ?? "whatsapp";
    const threadId = encodeThreadId(c.account_id, c.id);
    // Only WhatsApp's peer id is a phone number: an Instagram or Messenger id never is (CLAUDE.md, leads).
    const peerPhone = channel === "whatsapp" ? digits(c.peer_external_id) : null;

    let person = people.get(key);
    if (!person) {
      person = {
        id: key,
        name: "",
        phone: null,
        threads: [],
        source: "Not tracked",
        sourceDetail: null,
        sourceRef: null,
        interests: [],
        alerts: [],
        firstSeenAt: lead?.first_seen_at ?? null,
        lastSeenAt: lead?.last_seen_at ?? null,
        crm: null,
      };
      people.set(key, person);
    }
    person.name ||= (lead?.display_name ?? "").trim() || (c.peer_display ?? "").trim();
    person.phone ??= digits(lead?.phone) ?? peerPhone;
    person.threads.push({ threadId, channel, brand: c.brand, lastMessageAt: c.last_message_at, lastInboundAt: c.last_inbound_at, unread: c.unread_count ?? 0 });
    person.alerts.push(...(alertsByThread.get(threadId) ?? []));
    person.firstSeenAt = earliest(person.firstSeenAt, c.created_at);
    person.lastSeenAt = latest(person.lastSeenAt, latest(c.last_message_at, c.last_inbound_at));
  }

  // Where they came from: the FIRST touch. What they asked about: most-mentioned first.
  const firstTouch = new Map<string, PeopleRows["touchpoints"][number]>();
  for (const t of rows.touchpoints) {
    const seen = firstTouch.get(t.lead_id);
    if (!seen || Date.parse(t.occurred_at ?? "") < Date.parse(seen.occurred_at ?? "")) firstTouch.set(t.lead_id, t);
  }
  const interestsByLead = new Map<string, { car: string; n: number }[]>();
  for (const i of rows.interests) {
    if (!i.car_key) continue;
    const car = modelByCatalogueId(MONZA_KNOWLEDGE, i.car_key)?.displayName ?? i.car_key;
    const list = interestsByLead.get(i.lead_id) ?? [];
    list.push({ car, n: i.mention_count ?? 1 });
    interestsByLead.set(i.lead_id, list);
  }
  for (const person of people.values()) {
    if (!person.id.startsWith("lead:")) continue;
    const leadId = person.id.slice(5);
    const touch = firstTouch.get(leadId);
    if (touch) {
      person.source = SOURCE_LABEL[touch.source_kind ?? "direct"] ?? "Not tracked";
      person.sourceDetail = (touch.headline ?? "").trim() || null;
      person.sourceRef = (touch.source_ref ?? "").trim() || null;
    }
    person.interests = (interestsByLead.get(leadId) ?? []).sort((a, b) => b.n - a.n).map((x) => x.car);
  }

  for (const person of people.values()) {
    if (person.name === "") person.name = person.phone ? `+${person.phone}` : "Unnamed";
    person.threads.sort((a, b) => Date.parse(b.lastMessageAt ?? "0") - Date.parse(a.lastMessageAt ?? "0"));
    person.alerts.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }
  // Waiting for a person first, then newest activity.
  return [...people.values()].sort(
    (a, b) => Number(b.alerts.length > 0) - Number(a.alerts.length > 0) || Date.parse(b.lastSeenAt ?? "0") - Date.parse(a.lastSeenAt ?? "0")
  );
}

/**
 * Add the CRM's customers to the people who chatted.
 *
 * A chat is linked to a CRM customer ONLY by a Lebanese MOBILE number that is
 * the same on both sides — never by a name, never by a landline (a household
 * shares one): the rule of lib/leads, applied at display time. Nothing is
 * written anywhere: the link exists for this page view, for this staff member,
 * under their own CRM access. A CRM customer who never wrote becomes a person
 * too, so the list is every customer Monza has, not only the ones who chatted.
 */
export function mergeCrm(people: readonly Person[], customers: readonly CrmRecord[]): Person[] {
  const byMobile = new Map<string, CrmRecord>();
  for (const c of customers) {
    const n = normalizeLebanesePhone(c.phone);
    if (n && isAutoLinkable(c.phone) && !byMobile.has(n)) byMobile.set(n, c);
  }
  const used = new Set<string>();
  const merged = people.map((p) => {
    const n = p.phone ? normalizeLebanesePhone(p.phone) : null;
    const match = n && isAutoLinkable(p.phone) ? byMobile.get(n) ?? null : null;
    if (!match || used.has(match.customerId)) return p;
    used.add(match.customerId);
    return { ...p, crm: match, name: p.name.startsWith("+") || p.name === "Unnamed" ? match.name || p.name : p.name };
  });
  const crmOnly: Person[] = customers
    .filter((c) => !used.has(c.customerId))
    .map((c) => ({
      id: `crm:${c.customerId}`,
      name: c.name || "Unnamed",
      phone: (c.phone ?? "").replace(/\D/g, "") || null,
      threads: [],
      source: "CRM record",
      sourceDetail: c.leadSource,
      sourceRef: null,
      interests: [],
      alerts: [],
      firstSeenAt: c.since,
      lastSeenAt: c.since,
      crm: c,
    }));
  return [...merged, ...crmOnly];
}

/** Name, phone number (with or without the country code, spaces ignored) or a car they asked about. */
export function personMatches(person: Person, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (q === "") return true;
  const qDigits = q.replace(/\D/g, "").replace(/^0+/, "");
  if (qDigits.length >= 3 && person.phone?.includes(qDigits)) return true;
  return [person.name, person.source, person.sourceDetail ?? "", ...person.interests, person.crm?.email ?? "", ...(person.crm?.cars ?? [])].some((s) => s.toLowerCase().includes(q));
}

/* ── The summary above the list, and the export ──────────────────────────── */

export interface PeopleSummary {
  people: number;
  waiting: number;
  fromAds: number;
  notTracked: number;
  /** People with a CRM record (as far as this staff member may see). */
  inCrm: number;
  /** People who chatted and have no CRM record: leads still to be entered. */
  chattedNotInCrm: number;
  /** Each ad or post that brought somebody, most people first. */
  sources: { label: string; people: number }[];
  /** Each car somebody asked about, most people first. */
  cars: { car: string; people: number }[];
}

export function summarisePeople(people: readonly Person[]): PeopleSummary {
  const sources = new Map<string, number>();
  const cars = new Map<string, number>();
  for (const p of people) {
    if (p.source !== "Not tracked") {
      const label = p.sourceDetail ? `${p.source}: ${p.sourceDetail}` : p.source;
      sources.set(label, (sources.get(label) ?? 0) + 1);
    }
    for (const car of p.interests) cars.set(car, (cars.get(car) ?? 0) + 1);
  }
  const byCount = <T extends { people: number }>(a: T, b: T) => b.people - a.people;
  return {
    people: people.length,
    waiting: people.filter((p) => p.alerts.length > 0).length,
    fromAds: people.filter((p) => p.source === "Ad click").length,
    // "Not tracked" is a real number somebody spends money by: it is shown, never folded away.
    notTracked: people.filter((p) => p.source === "Not tracked").length,
    inCrm: people.filter((p) => p.crm !== null).length,
    chattedNotInCrm: people.filter((p) => p.crm === null && p.threads.length > 0).length,
    sources: [...sources].map(([label, n]) => ({ label, people: n })).sort(byCount),
    cars: [...cars].map(([car, n]) => ({ car, people: n })).sort(byCount),
  };
}

/** A spreadsheet of the list as shown. A cell never starts a formula (a customer chooses their own name). */
export function peopleCsv(people: readonly Person[]): string {
  const cell = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const head = ["Name", "Phone", "Channels", "Came from", "Ad or post", "Asked about", "Waiting for a person", "First seen", "Last seen", "In the CRM", "Cars (CRM)", "Active payment plans"];
  const lines = people.map((p) =>
    [
      p.name,
      p.phone ? `+${p.phone}` : "",
      [...new Set(p.threads.map((t) => t.channel))].join(" / "),
      p.source,
      p.sourceDetail ?? "",
      p.interests.join(" / "),
      p.alerts.length > 0 ? "yes" : "",
      (p.firstSeenAt ?? "").slice(0, 10),
      (p.lastSeenAt ?? "").slice(0, 10),
      p.crm ? "yes" : "",
      (p.crm?.cars ?? []).join(" / "),
      p.crm && p.crm.activePlans > 0 ? String(p.crm.activePlans) : "",
    ]
      .map(cell)
      .join(",")
  );
  return [head.map(cell).join(","), ...lines].join("\r\n");
}
