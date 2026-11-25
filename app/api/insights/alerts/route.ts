/**
 * GET  /api/insights/alerts   the review: every open alert with its verdict and the evidence for
 *                             it, who is waiting and for how long, the load per salesperson, the
 *                             test-drive requests, and what "Apply" would close. READS ONLY.
 * POST /api/insights/alerts
 *   { action: "apply" }                          close what the evidence says is answered or
 *                                                duplicated; turn answered test-drive alerts into
 *                                                requests; write the verdicts (reconcile-server.ts)
 *   { action: "close", ids, reason }             a person closes alerts in bulk, with a reason
 *   { action: "class", conversationId, class }   a person corrects a conversation's class (null = undo)
 *   { action: "rule", staffId, brand?, channel?, weight?, active? } / { action: "rule_remove", id }
 *                                                who is in the rotation for new leads
 *
 * Owner and managers (Insights access). Nothing here returns a customer's words.
 */

import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { INSIGHTS_CAPS } from "@/lib/insights/access";
import { channelDb } from "@/lib/channels/store";
import { actorOf, assignableStaff } from "@/lib/leads/ownership-server";
import { applyReconcile, closeAlerts, readSnapshot, setClass } from "@/lib/alerts/reconcile-server";
import { AUTO_CLOSE, CLOSE_REASONS, isCloseReason } from "@/lib/alerts/reconcile";
import { CLASS_LABEL, CONVERSATION_CLASSES, isConversationClass } from "@/lib/alerts/intent";
import { KIND_WORDS, sortKinds } from "@/lib/wasales/alerts";
import { NEXT_ACTION_LABEL, STATUS_LABEL, needsAction } from "@/lib/testdrives/lifecycle";
import { MONZA_KNOWLEDGE } from "@/lib/wasales/knowledge";
import { alertReconcileApplies } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" };
const deny = (reason: string) => NextResponse.json({ ok: false, message: "Not available for your role." }, { status: reason === "unauthenticated" ? 401 : 403, headers: NO_STORE });

export async function GET(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request, INSIGHTS_CAPS);
  if (!access.ok) return deny(access.reason);
  const now = Date.now();
  const snap = await readSnapshot(now);
  if (!snap) {
    return NextResponse.json({ ok: false, message: "The alerts could not be read. If this is the first time, migration 033 has not been applied yet." }, { status: 503, headers: NO_STORE });
  }
  const sb = channelDb();
  const [staff, rules] = await Promise.all([
    assignableStaff(access.user).catch(() => []),
    sb ? sb.from("lead_assignment_rules").select("id, staff_id, staff_name, brand, channel, weight, active").order("staff_name") : Promise.resolve({ data: [] }),
  ]);
  const alertOf = new Map(snap.alerts.map((a) => [a.id, a]));
  const waitingOf = new Map(snap.waiting.map((w) => [w.conversationId, w]));
  const rows = snap.verdicts.map((v) => {
    const a = alertOf.get(v.alertId)!;
    const chat = snap.chats.get(v.conversationId)!;
    const cls = snap.classes.get(v.conversationId) ?? { class: "general" as const, source: "labels" as const };
    const w = waitingOf.get(v.conversationId);
    return {
      alertId: v.alertId,
      conversationId: v.conversationId,
      threadId: a.threadId,
      name: a.customerName,
      channel: chat.channel,
      brand: chat.brand,
      verdict: v.verdict,
      evidence: v.evidence,
      reasons: sortKinds([a.kind, ...a.tags]).map((k) => KIND_WORDS[k]),
      class: cls.class,
      classSource: cls.source,
      owner: chat.ownerName,
      raisedAt: a.createdAt,
      lastCustomerAt: chat.lastCustomerAt,
      lastPersonAt: chat.lastPersonAt,
      waitingHours: w?.waitingHours ?? null,
      inWindow: w?.inWindow ?? null,
      windowHoursLeft: w?.windowHoursLeft ?? null,
    };
  });
  const nameOf = new Map(snap.alerts.map((a) => [a.conversationId, { name: a.customerName, threadId: a.threadId }]));
  return NextResponse.json(
    {
      ok: true,
      at: snap.at,
      counts: snap.counts,
      // What pressing "Apply" would do, from this same read.
      wouldClose: {
        answered: snap.counts.answered,
        duplicate: snap.counts.duplicate,
        intoTestDrive: snap.verdicts.filter((v) => {
          if (v.verdict !== "follow_up") return false;
          const a = alertOf.get(v.alertId)!;
          const kinds = sortKinds([a.kind, ...a.tags]);
          return kinds.includes("TEST_DRIVE") && !kinds.some((k) => k === "BUYING" || k === "CALLBACK" || k === "TRADE_IN");
        }).length,
      },
      autoApplies: alertReconcileApplies(),
      waiting: snap.waitingSummary,
      ownerLoad: snap.ownerLoad,
      rows,
      testDrives: snap.testDrives.map((d) => ({
        ...d,
        statusLabel: STATUS_LABEL[d.status],
        needs: needsAction(d, now),
        name: nameOf.get(d.conversationId)?.name ?? null,
        threadId: nameOf.get(d.conversationId)?.threadId ?? null,
      })),
      testDriveSummary: snap.testDriveSummary,
      vocab: {
        classes: CONVERSATION_CLASSES.map((c) => ({ key: c, label: CLASS_LABEL[c] })),
        closeReasons: Object.entries(CLOSE_REASONS).map(([key, label]) => ({ key, label })),
        autoClose: AUTO_CLOSE,
        nextActions: NEXT_ACTION_LABEL,
        statuses: STATUS_LABEL,
        cars: MONZA_KNOWLEDGE.models.map((m) => ({ code: m.code, name: m.displayName })),
        staff,
      },
      rules: (rules as { data: unknown }).data ?? [],
    },
    { headers: NO_STORE }
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request, INSIGHTS_CAPS);
  if (!access.ok) return deny(access.reason);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const actor = await actorOf(access.user);
  const by = { id: actor.id, name: actor.name };
  const bad = (message: string, status = 400) => NextResponse.json({ ok: false, message }, { status, headers: NO_STORE });
  if (!body || typeof body.action !== "string") return bad("Unknown request.");

  if (body.action === "apply") {
    const result = await applyReconcile(by);
    if (!result) return bad("The alerts could not be read, so nothing was changed.", 503);
    return NextResponse.json({ ok: true, result }, { headers: NO_STORE });
  }

  if (body.action === "close") {
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 1000) : [];
    if (ids.length === 0 || !isCloseReason(body.reason)) return bad("Choose the alerts and a reason.");
    const result = await closeAlerts(ids, body.reason, by);
    if (!result) return bad("They could not be closed just now.", 503);
    return NextResponse.json({ ok: true, closed: result.closed }, { headers: NO_STORE });
  }

  if (body.action === "class") {
    if (typeof body.conversationId !== "string" || !(body.class === null || isConversationClass(body.class))) return bad("Choose a class from the list.");
    const ok = await setClass(body.conversationId, body.class as never, by);
    return ok ? NextResponse.json({ ok: true }, { headers: NO_STORE }) : bad("It could not be saved just now.", 503);
  }

  const sb = channelDb();
  if (!sb) return bad("The database is not reachable here.", 503);

  if (body.action === "rule") {
    const staff = await assignableStaff(access.user);
    const pick = staff.find((s) => s.id === body.staffId);
    if (!pick) return bad("Choose the salesperson from the list.");
    const brand = body.brand === "voyah" || body.brand === "mhero" || body.brand === "monza" ? body.brand : null;
    const channel = body.channel === "whatsapp" || body.channel === "instagram" || body.channel === "facebook" ? body.channel : null;
    const weight = Math.min(10, Math.max(1, Math.round(Number(body.weight) || 1)));
    const { error } = await sb
      .from("lead_assignment_rules")
      .upsert(
        { staff_id: pick.id, staff_name: pick.name, brand, channel, weight, active: body.active !== false, set_by: by.id, set_name: by.name.slice(0, 120), set_at: new Date().toISOString() },
        { onConflict: "staff_id,brand,channel" }
      );
    return error ? bad("It could not be saved just now.", 503) : NextResponse.json({ ok: true }, { headers: NO_STORE });
  }

  if (body.action === "rule_remove") {
    if (typeof body.id !== "string") return bad("Unknown rule.");
    const { error } = await sb.from("lead_assignment_rules").delete().eq("id", body.id);
    return error ? bad("It could not be removed just now.", 503) : NextResponse.json({ ok: true }, { headers: NO_STORE });
  }

  return bad("Unknown request.");
}
