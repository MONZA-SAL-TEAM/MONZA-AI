/**
 * The alerts, read and — only when told to — set right. The rules are reconcile.ts / intent.ts /
 * waiting.ts (pure); this file is the I/O around them.
 *
 *   readSnapshot()     everything as it is NOW: each open alert's verdict, who is waiting, the
 *                      classes, the load per salesperson. Reads only. The review screen, the
 *                      morning brief's feed and the nightly job all start here, so none of them
 *                      depends on somebody having opened a page (the Decision Center's figures
 *                      were 23 days old on 2026-11-25 because it refreshes only when looked at).
 *   applyReconcile()   closes what the evidence says is answered or duplicated, turns answered
 *                      test-drive alerts into test-drive requests, writes every verdict and an
 *                      audit row for each change. Never closes waiting / unverified / historical.
 *
 * Needs migration 033. Without it readSnapshot answers null and nothing here writes.
 */

import { channelDb } from "@/lib/channels/store";
import { maxUrgency, sortKinds } from "@/lib/wasales/alerts";
import type { AlertKind, AlertUrgency } from "@/lib/wasales/actions";
import { AUTO_CLOSE, countVerdicts, reconcileAlerts, type AlertVerdict, type ChatFact, type VerdictCounts, type CloseReason } from "@/lib/alerts/reconcile";
import { classOf, isActionable, isConversationClass, type ConversationClass } from "@/lib/alerts/intent";
import { loadByOwner, summariseWaiting, waitingRows, type OwnerLoad, type WaitingRow, type WaitingSummary } from "@/lib/alerts/waiting";
import { needsAction, statusFromAlert, type TestDriveStatus } from "@/lib/testdrives/lifecycle";
import { chooseAssignee, type AssignmentRule } from "@/lib/alerts/assign";

export interface AlertRow {
  id: string;
  accountId: string;
  conversationId: string;
  threadId: string | null;
  kind: AlertKind;
  tags: AlertKind[];
  urgency: AlertUrgency;
  models: string[];
  customerName: string | null;
  createdAt: string;
}

export interface ChatRow extends ChatFact {
  accountId: string;
  brand: string;
  channel: string;
  ownerId: string | null;
  ownerName: string | null;
}

export interface TestDriveRow {
  id: string;
  conversationId: string;
  status: TestDriveStatus;
  slotAt: string | null;
  models: string[];
  vehicle: string | null;
  salespersonName: string | null;
  requestedAt: string;
}

export interface Snapshot {
  at: string;
  alerts: AlertRow[];
  chats: Map<string, ChatRow>;
  verdicts: AlertVerdict[];
  counts: VerdictCounts;
  classes: Map<string, { class: ConversationClass; source: "person" | "labels" }>;
  waiting: WaitingRow[];
  waitingSummary: WaitingSummary;
  ownerLoad: OwnerLoad[];
  testDrives: TestDriveRow[];
  testDriveSummary: { open: number; notContacted: number; outcomeMissing: number; booked: number };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

async function pageAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[] | null> {
  const out: T[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error || !Array.isArray(data)) return null;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

async function inChunks<T>(ids: readonly string[], build: (chunk: string[]) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[] | null> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await build(ids.slice(i, i + 150));
    if (error || !Array.isArray(data)) return null;
    out.push(...(data as T[]));
  }
  return out;
}

/** Everything as it is now. Reads only. null = it could not be read (never an empty answer). */
export async function readSnapshot(nowMs: number = Date.now()): Promise<Snapshot | null> {
  const sb = channelDb();
  if (!sb) return null;
  const rawAlerts = await pageAll<Record<string, unknown>>((from, to) =>
    sb
      .from("sales_alerts")
      .select("id, account_id, conversation_ref, thread_id, kind, tags, urgency, models, customer_name, created_at")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .range(from, to)
  );
  if (!rawAlerts) return null;
  const alerts: AlertRow[] = rawAlerts
    .filter((r) => typeof r.conversation_ref === "string" && UUID.test(r.conversation_ref))
    .map((r) => ({
      id: String(r.id),
      accountId: String(r.account_id),
      conversationId: String(r.conversation_ref),
      threadId: str(r.thread_id),
      kind: r.kind as AlertKind,
      tags: Array.isArray(r.tags) ? (r.tags as AlertKind[]) : [],
      urgency: (str(r.urgency) ?? "normal") as AlertUrgency,
      models: Array.isArray(r.models) ? (r.models as string[]) : [],
      customerName: str(r.customer_name),
      createdAt: String(r.created_at),
    }));

  const { data: factData, error: factError } = await sb.rpc("alert_chat_facts");
  if (factError || !Array.isArray(factData)) return null;
  const chats = new Map<string, ChatRow>();
  for (const f of factData as Record<string, unknown>[]) {
    const id = String(f.conversation_id);
    chats.set(id, {
      conversationId: id,
      accountId: String(f.account_id),
      brand: String(f.brand),
      channel: String(f.channel),
      stored: f.stored === true,
      ownerId: str(f.owner_id),
      ownerName: str(f.owner_name),
      lastCustomerAt: str(f.last_customer_at),
      lastPersonAt: str(f.last_person_at),
      waitingSince: str(f.waiting_since),
      everAnswered: f.ever_answered === true,
    });
  }
  const convIds = [...chats.keys()];

  const [overrides, signals, drives] = await Promise.all([
    inChunks<{ conversation_id: string; class: string }>(convIds, (chunk) => sb.from("conversation_classes").select("conversation_id, class").in("conversation_id", chunk)),
    inChunks<{ conversation_id: string; intents: string[] | null; owner_support: boolean | null }>(convIds, (chunk) =>
      sb
        .from("sales_signals")
        .select("conversation_id, intents, owner_support")
        .in("conversation_id", chunk)
        .gte("at", new Date(nowMs - 60 * 86_400_000).toISOString())
        .limit(5000)
    ),
    pageAll<Record<string, unknown>>((from, to) =>
      sb
        .from("test_drive_requests")
        .select("id, conversation_id, status, slot_at, models, vehicle, salesperson_name, requested_at")
        .in("status", ["requested", "contacted", "awaiting_confirmation", "booked"])
        .order("requested_at", { ascending: false })
        .range(from, to)
    ),
  ]);
  if (!overrides || !signals || !drives) return null;

  const verdicts = reconcileAlerts(alerts, chats, nowMs);
  const overrideOf = new Map(overrides.filter((o) => isConversationClass(o.class)).map((o) => [o.conversation_id, o.class as ConversationClass]));
  const intentsOf = new Map<string, Set<string>>();
  const ownerSupport = new Set<string>();
  for (const s of signals) {
    const set = intentsOf.get(s.conversation_id) ?? new Set<string>();
    for (const i of s.intents ?? []) set.add(i);
    intentsOf.set(s.conversation_id, set);
    if (s.owner_support) ownerSupport.add(s.conversation_id);
  }
  const kindsOf = new Map<string, Set<string>>();
  for (const a of alerts) {
    const set = kindsOf.get(a.conversationId) ?? new Set<string>();
    set.add(a.kind);
    for (const t of a.tags) set.add(t);
    kindsOf.set(a.conversationId, set);
  }
  const classes = new Map<string, { class: ConversationClass; source: "person" | "labels" }>();
  for (const id of convIds) {
    classes.set(
      id,
      classOf({ override: overrideOf.get(id) ?? null, alertKinds: [...(kindsOf.get(id) ?? [])], intents: [...(intentsOf.get(id) ?? [])], ownerSupport: ownerSupport.has(id) })
    );
  }

  const waiting = waitingRows(
    verdicts
      .filter((v) => v.verdict === "waiting")
      .flatMap((v) => {
        const chat = chats.get(v.conversationId)!;
        const cls = classes.get(v.conversationId)?.class ?? "general";
        // Spam, a supplier's pitch and "no action" are nobody's wait.
        if (!isActionable(cls) || !chat.waitingSince || !chat.lastCustomerAt) return [];
        return [{ conversationId: v.conversationId, waitingSince: chat.waitingSince, lastCustomerAt: chat.lastCustomerAt, neverAnswered: !chat.everAnswered, class: cls, ownerId: chat.ownerId, ownerName: chat.ownerName }];
      }),
    nowMs
  );
  const testDrives: TestDriveRow[] = drives.map((d) => ({
    id: String(d.id),
    conversationId: String(d.conversation_id),
    status: d.status as TestDriveStatus,
    slotAt: str(d.slot_at),
    models: Array.isArray(d.models) ? (d.models as string[]) : [],
    vehicle: str(d.vehicle),
    salespersonName: str(d.salesperson_name),
    requestedAt: String(d.requested_at),
  }));
  const actions = testDrives.map((d) => needsAction(d, nowMs));

  return {
    at: new Date(nowMs).toISOString(),
    alerts,
    chats,
    verdicts,
    counts: countVerdicts(verdicts),
    classes,
    waiting,
    waitingSummary: summariseWaiting(waiting),
    ownerLoad: loadByOwner(waiting),
    testDrives,
    testDriveSummary: {
      open: testDrives.length,
      notContacted: actions.filter((a) => a === "not_contacted").length,
      outcomeMissing: actions.filter((a) => a === "outcome_missing").length,
      booked: testDrives.filter((d) => d.status === "booked").length,
    },
  };
}

export interface ReconcileResult {
  closedAnswered: number;
  closedDuplicates: number;
  testDriveRequests: number;
  closedIntoTestDrive: number;
  assigned: number;
  verdictsWritten: number;
  failed: number;
}

type Who = { id: string; name: string } | null;

const hasOnlyTestDriveAsManual = (kinds: readonly AlertKind[]) =>
  kinds.includes("TEST_DRIVE") && !kinds.some((k) => k === "BUYING" || k === "CALLBACK" || k === "TRADE_IN");

/**
 * Set the alerts right, from the evidence. Every change is one conditional UPDATE (`status = open`),
 * so running it twice, or twice at once, changes nothing the second time; every change writes an
 * audit row. `by` is the person who pressed the button, or null for the nightly job.
 */
export async function applyReconcile(by: Who, nowMs: number = Date.now()): Promise<ReconcileResult | null> {
  const sb = channelDb();
  const snap = await readSnapshot(nowMs);
  if (!sb || !snap) return null;
  const at = new Date(nowMs).toISOString();
  const res: ReconcileResult = { closedAnswered: 0, closedDuplicates: 0, testDriveRequests: 0, closedIntoTestDrive: 0, assigned: 0, verdictsWritten: 0, failed: 0 };
  const alertOf = new Map(snap.alerts.map((a) => [a.id, a]));
  const event = (alertId: string, action: string, reason: string) =>
    sb.from("sales_alert_events").insert({ alert_id: alertId, action, reason, by_staff: by?.id ?? null, by_name: by?.name ?? null });

  // 1. Duplicates: their reasons go onto the chat's surviving alert first, then they close.
  const bySurvivor = new Map<string, AlertRow[]>();
  for (const v of snap.verdicts) {
    if (v.verdict !== "duplicate" || !v.survivorId) continue;
    const dup = alertOf.get(v.alertId);
    if (dup) bySurvivor.set(v.survivorId, [...(bySurvivor.get(v.survivorId) ?? []), dup]);
  }
  const mergedKinds = new Map<string, AlertKind[]>();
  for (const [survivorId, dups] of bySurvivor) {
    const s = alertOf.get(survivorId);
    if (!s) continue;
    const tags = sortKinds([s.kind, ...s.tags, ...dups.flatMap((d) => [d.kind, ...d.tags])]);
    const models = [...new Set([...s.models, ...dups.flatMap((d) => d.models)])].slice(0, 8);
    const urgency = dups.map((d) => d.urgency).reduce(maxUrgency, s.urgency);
    const { error } = await sb.from("sales_alerts").update({ kind: tags[0], tags, models, urgency }).eq("id", survivorId).eq("status", "open");
    if (error) {
      res.failed += 1;
      continue; // the duplicates stay open: nothing is lost
    }
    mergedKinds.set(survivorId, tags);
    await event(survivorId, "merged", "newer_alert_open");
    for (const d of dups) {
      const { data, error: closeError } = await sb
        .from("sales_alerts")
        .update({ status: "done", closed_at: at, closed_by: AUTO_CLOSE.duplicate, close_reason: "duplicate", superseded_by: survivorId, verdict: "duplicate", verdict_at: at })
        .eq("id", d.id)
        .eq("status", "open")
        .select("id");
      if (closeError) res.failed += 1;
      else if (Array.isArray(data) && data.length > 0) {
        res.closedDuplicates += 1;
        await event(d.id, "auto_closed", "newer_alert_open");
      }
    }
  }

  // 2. Each chat's one alert.
  for (const v of snap.verdicts) {
    if (v.verdict === "duplicate") continue;
    const a = alertOf.get(v.alertId);
    const chat = snap.chats.get(v.conversationId);
    if (!a || !chat) continue;
    const kinds = mergedKinds.get(a.id) ?? sortKinds([a.kind, ...a.tags]);

    if (v.verdict === "answered") {
      const { data, error } = await sb
        .from("sales_alerts")
        .update({ status: "done", closed_at: at, closed_by: AUTO_CLOSE.answered, close_reason: "answered", verdict: "answered", verdict_at: at })
        .eq("id", a.id)
        .eq("status", "open")
        .select("id");
      if (error) res.failed += 1;
      else if (Array.isArray(data) && data.length > 0) {
        res.closedAnswered += 1;
        await event(a.id, "auto_closed", v.evidence);
      }
      continue;
    }

    // A test drive somebody asked for becomes a request with a lifecycle of its own.
    if (kinds.includes("TEST_DRIVE") && (v.verdict === "follow_up" || v.verdict === "waiting")) {
      const status = statusFromAlert(v.verdict === "follow_up");
      const { data: made, error: makeError } = await sb
        .from("test_drive_requests")
        .insert({ conversation_id: v.conversationId, account_id: chat.accountId, models: a.models.slice(0, 8), status, source_alert_id: a.id, requested_at: a.createdAt })
        .select("id");
      // 23505 = this chat already has a request in progress: that one stands.
      const created = !makeError && Array.isArray(made) && made.length > 0;
      if (created) {
        res.testDriveRequests += 1;
        await sb.from("test_drive_request_events").insert({ request_id: (made as { id: string }[])[0].id, from_status: null, to_status: status, by_staff: by?.id ?? null, by_name: by?.name ?? "From the open alert" });
      }
      const exists = created || (makeError as { code?: string } | null)?.code === "23505";
      // Answered, and the only thing left was the drive: the request carries it now.
      if (exists && v.verdict === "follow_up" && hasOnlyTestDriveAsManual(kinds)) {
        const { data, error } = await sb
          .from("sales_alerts")
          .update({ status: "done", closed_at: at, closed_by: "auto: now a test-drive request", close_reason: "handled", verdict: "follow_up", verdict_at: at })
          .eq("id", a.id)
          .eq("status", "open")
          .select("id");
        if (error) res.failed += 1;
        else if (Array.isArray(data) && data.length > 0) {
          res.closedIntoTestDrive += 1;
          await event(a.id, "auto_closed", "person_replied_outcome_open");
        }
        continue;
      }
    }

    const { error } = await sb.from("sales_alerts").update({ verdict: v.verdict, verdict_at: at }).eq("id", a.id).eq("status", "open");
    if (error) res.failed += 1;
    else res.verdictsWritten += 1;
  }

  // 3. New sales leads with nobody responsible, when an admin has said who is in the rotation.
  const { data: ruleRows } = await sb.from("lead_assignment_rules").select("staff_id, staff_name, brand, channel, weight, active");
  const rules: AssignmentRule[] = ((ruleRows ?? []) as Record<string, unknown>[]).map((r) => ({
    staffId: String(r.staff_id),
    staffName: String(r.staff_name),
    brand: str(r.brand),
    channel: str(r.channel),
    weight: Number(r.weight) || 1,
    active: r.active === true,
  }));
  if (rules.some((r) => r.active)) {
    const load: Record<string, number> = {};
    for (const c of snap.chats.values()) if (c.ownerId) load[c.ownerId] = (load[c.ownerId] ?? 0) + 1;
    for (const w of snap.waiting) {
      if (w.ownerId) continue;
      const chat = snap.chats.get(w.conversationId)!;
      const pick = chooseAssignee(rules, { brand: chat.brand, channel: chat.channel }, load);
      if (!pick) continue;
      const { data, error } = await sb
        .from("channel_conversations")
        .update({ assigned_to: pick.staffId, assigned_name: pick.staffName, assigned_at: at, assigned_by: by?.id ?? pick.staffId })
        .eq("id", w.conversationId)
        .is("assigned_to", null)
        .select("id");
      if (error || !Array.isArray(data) || data.length === 0) continue;
      load[pick.staffId] = (load[pick.staffId] ?? 0) + 1;
      res.assigned += 1;
      await sb.from("conversation_owner_events").insert({
        conversation_id: w.conversationId,
        account_id: chat.accountId,
        action: "assign",
        from_staff: null,
        from_name: null,
        to_staff: pick.staffId,
        to_name: pick.staffName,
        by_staff: by?.id ?? pick.staffId,
        by_name: by?.name ?? "Automatic (assignment rule)",
      });
    }
  }
  return res;
}

/** A person closes alerts in bulk, with a reason from the closed list. Each is logged. */
export async function closeAlerts(ids: readonly string[], reason: CloseReason, by: { id: string; name: string }): Promise<{ closed: number } | null> {
  const sb = channelDb();
  if (!sb) return null;
  const at = new Date().toISOString();
  let closed = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100).filter((id) => UUID.test(id));
    if (chunk.length === 0) continue;
    const { data, error } = await sb
      .from("sales_alerts")
      .update({ status: "done", closed_at: at, closed_by: by.name.slice(0, 120), close_reason: reason === "duplicate" ? "duplicate" : reason })
      .in("id", chunk)
      .eq("status", "open")
      .select("id");
    if (error) return null;
    const done = (data ?? []) as { id: string }[];
    closed += done.length;
    if (done.length > 0) {
      await sb.from("sales_alert_events").insert(done.map((d) => ({ alert_id: d.id, action: "closed", reason, by_staff: by.id, by_name: by.name.slice(0, 120) })));
    }
  }
  return { closed };
}

/** A person corrects a conversation's class; the correction wins from then on and is logged. */
export async function setClass(conversationId: string, to: ConversationClass | null, by: { id: string; name: string }): Promise<boolean> {
  const sb = channelDb();
  if (!sb || !UUID.test(conversationId)) return false;
  const { data: before } = await sb.from("conversation_classes").select("class").eq("conversation_id", conversationId).maybeSingle();
  const from = (before as { class?: string } | null)?.class ?? null;
  const { error } = to
    ? await sb.from("conversation_classes").upsert({ conversation_id: conversationId, class: to, set_by: by.id, set_name: by.name.slice(0, 120), set_at: new Date().toISOString() })
    : await sb.from("conversation_classes").delete().eq("conversation_id", conversationId);
  if (error) return false;
  await sb.from("conversation_class_events").insert({ conversation_id: conversationId, from_class: from, to_class: to, by_staff: by.id, by_name: by.name.slice(0, 120) });
  return true;
}
