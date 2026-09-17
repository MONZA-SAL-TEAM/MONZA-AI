/**
 * Sales follow-ups the bot creates — SERVER ONLY (Samer's workbook, C Decisions,
 * 2026-09-17):
 *
 *   ALERTS     "alert 70 70 85 85 to call the client": a row in sales_alerts
 *              (migration 013) that the inbox shows as "Call this client", and a
 *              WhatsApp message to the salesperson's own phone when
 *              SALES_ALERT_WHATSAPP_TO and SALES_ALERT_TEMPLATE are set.
 *   BOOKINGS   the test-drive calendar (migration 014). One booked row per slot
 *              is the database's rule, so a slot taken a moment earlier by
 *              another chat is refused here as "taken".
 *
 * The engine only DECIDES these (ALERT_SALES, BOOK_TEST_DRIVE actions); this file
 * carries them out, after the customer's reply went (an alert) or before it
 * (a booking — the confirmation must not go out for a slot we do not hold).
 */

import { channelToken } from "@/lib/env";
import { channelDb, listAccounts } from "@/lib/channels/store";
import { sendWhatsAppTemplate } from "@/lib/channels/whatsapp";
import { slotLabel } from "@/lib/wasales/booking";
import { MONZA_KNOWLEDGE, modelByCode, type ModelCode } from "@/lib/wasales/knowledge";
import type { AlertKind } from "@/lib/wasales/actions";

export interface ChatRef {
  accountId: string;
  brand: string;
  conversationRef: string;
  threadId: string;
  /** The customer's WhatsApp number (digits), when the chat is on WhatsApp. */
  customerPhone: string | null;
}

export interface SalesAlert {
  id: string;
  accountId: string;
  threadId: string;
  kind: AlertKind;
  models: string[];
  customerName: string | null;
  customerPhone: string | null;
  slotAt: string | null;
  /** Why a person is needed (NEEDS_PERSON): the engine's words, never the customer's. */
  reason: string | null;
  status: "open" | "done";
  createdAt: string;
}

export interface Booking {
  id: string;
  slotAt: string;
  accountId: string;
  threadId: string;
  models: string[];
  customerPhone: string | null;
  customerName: string | null;
  status: "booked" | "cancelled";
}

const KIND_LABEL: Readonly<Record<AlertKind, string>> = {
  PRICE: "Asked for the price",
  FINANCING: "Asked about installments",
  TEST_DRIVE: "Test drive",
  STOCK: "Asked about availability",
  DISCOUNT: "Asked about offers",
  TRADE_IN: "Trade-in",
  NEEDS_PERSON: "Needs a person",
};

export function alertKindLabel(kind: AlertKind): string {
  return KIND_LABEL[kind];
}

function carNames(models: readonly string[]): string {
  return models.map((m) => modelByCode(MONZA_KNOWLEDGE, m)?.displayName ?? m).join(", ");
}

function digits(value: string | null | undefined): string | null {
  const d = (value ?? "").replace(/\D/g, "");
  return d.length >= 7 && d.length <= 15 ? d : null;
}

/* ── Bookings ────────────────────────────────────────────────────────────── */

/** Booked slots from `fromIso` on, for the engine's free-slot list. */
export async function bookedSlotsFrom(fromIso: string): Promise<string[]> {
  const sb = channelDb();
  if (!sb) return [];
  const { data, error } = await sb
    .from("test_drive_bookings")
    .select("slot_at")
    .eq("status", "booked")
    .gte("slot_at", fromIso)
    .limit(500);
  if (error || !Array.isArray(data)) {
    // Not applied yet, or unreadable: nothing is known booked, and the unique index still guards.
    return [];
  }
  return data.map((r) => new Date(String((r as { slot_at: string }).slot_at)).toISOString());
}

/** Hold a slot for this chat. "taken" when another chat holds it already. */
export async function bookTestDrive(
  chat: ChatRef,
  slot: string,
  models: readonly ModelCode[]
): Promise<"booked" | "taken" | "unavailable"> {
  const sb = channelDb();
  if (!sb) return "unavailable";
  const { error } = await sb.from("test_drive_bookings").insert({
    slot_at: slot,
    account_id: chat.accountId,
    brand: chat.brand,
    conversation_ref: chat.conversationRef,
    thread_id: chat.threadId,
    models: [...models],
    customer_phone: chat.customerPhone,
  });
  if (!error) return "booked";
  if (error.code === "23505") return "taken";
  console.error(`[sales/booking] could not book (${error.code ?? "?"})`);
  return "unavailable";
}

export async function listBookings(fromIso: string): Promise<Booking[] | null> {
  const sb = channelDb();
  if (!sb) return null;
  const { data, error } = await sb
    .from("test_drive_bookings")
    .select("id, slot_at, account_id, thread_id, conversation_ref, models, customer_phone, status")
    .gte("slot_at", fromIso)
    .order("slot_at", { ascending: true })
    .limit(300);
  if (error || !Array.isArray(data)) return null;
  // The name the customer gave lives on the chat's test-drive alert.
  const refs = [...new Set(data.map((r) => String((r as Record<string, unknown>).conversation_ref)))];
  const names = new Map<string, string>();
  if (refs.length > 0) {
    const { data: alerts } = await sb
      .from("sales_alerts")
      .select("conversation_ref, customer_name, created_at")
      .eq("kind", "TEST_DRIVE")
      .in("conversation_ref", refs)
      .not("customer_name", "is", null)
      .order("created_at", { ascending: false });
    for (const a of (alerts ?? []) as { conversation_ref: string; customer_name: string }[]) {
      if (!names.has(a.conversation_ref)) names.set(a.conversation_ref, a.customer_name);
    }
  }
  return data.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      slotAt: new Date(String(r.slot_at)).toISOString(),
      accountId: String(r.account_id),
      threadId: String(r.thread_id),
      models: Array.isArray(r.models) ? (r.models as string[]) : [],
      customerPhone: typeof r.customer_phone === "string" ? r.customer_phone : null,
      customerName: names.get(String(r.conversation_ref)) ?? null,
      status: r.status === "cancelled" ? "cancelled" : "booked",
    };
  });
}

export async function cancelBooking(id: string, staffName: string): Promise<boolean> {
  const sb = channelDb();
  if (!sb || !/^[0-9a-f-]{36}$/i.test(id)) return false;
  const { error } = await sb
    .from("test_drive_bookings")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by: staffName.slice(0, 120) })
    .eq("id", id)
    .eq("status", "booked");
  return !error;
}

/* ── Alerts ──────────────────────────────────────────────────────────────── */

/**
 * The WhatsApp message to the salesperson. Needs an APPROVED template (a business
 * cannot free-message a phone that has not written in 24 hours) with ONE body
 * variable, e.g. "New sales lead: {{1}}". Unset settings: no message, the inbox
 * alert still stands.
 */
async function notifySalesPhone(summary: string): Promise<boolean> {
  const to = (process.env.SALES_ALERT_WHATSAPP_TO ?? "")
    .split(",")
    .map((n) => digits(n))
    .filter((n): n is string => n !== null);
  const template = (process.env.SALES_ALERT_TEMPLATE ?? "").trim();
  if (to.length === 0 || template === "") return false;

  const account = (await listAccounts()).find((a) => a.channel === "whatsapp");
  const token = account ? channelToken(account.tokenEnv) : null;
  if (!account || !token) return false;

  let any = false;
  for (const number of to.slice(0, 5)) {
    const r = await sendWhatsAppTemplate(
      {
        phoneNumberId: account.externalId,
        to: number,
        template,
        language: (process.env.SALES_ALERT_TEMPLATE_LANG ?? "en").trim() || "en",
        bodyParams: [summary],
      },
      token
    );
    if (r.ok) any = true;
    else console.error(`[sales/alert] WhatsApp to the sales phone failed: ${r.problem}`);
  }
  return any;
}

/** One line for the salesperson: what, which car, who, their number. */
export function alertSummary(a: {
  kind: AlertKind;
  models: readonly string[];
  name: string | null;
  phone: string | null;
  slot: string | null;
}): string {
  return [
    KIND_LABEL[a.kind],
    a.models.length > 0 ? carNames(a.models) : null,
    a.slot ? slotLabel(a.slot) : null,
    a.name,
    a.phone ? `+${a.phone}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export async function recordAlert(
  chat: ChatRef,
  a: { kind: AlertKind; models: readonly ModelCode[]; name: string | null; phone: string | null; slot: string | null; reason?: string | null }
): Promise<boolean> {
  const sb = channelDb();
  if (!sb) return false;
  const phone = digits(a.phone) ?? chat.customerPhone;
  const name = a.name ? a.name.slice(0, 120) : null;

  // The same question twice in a row is one follow-up, not two.
  const since = new Date(Date.now() - 6 * 3_600_000).toISOString();
  const { data: recent } = await sb
    .from("sales_alerts")
    .select("id")
    .eq("account_id", chat.accountId)
    .eq("conversation_ref", chat.conversationRef)
    .eq("kind", a.kind)
    .eq("status", "open")
    .gte("created_at", since)
    .limit(1);
  if (Array.isArray(recent) && recent.length > 0 && !name && !a.slot) return true;

  const { data, error } = await sb
    .from("sales_alerts")
    .insert({
      account_id: chat.accountId,
      brand: chat.brand,
      conversation_ref: chat.conversationRef,
      thread_id: chat.threadId,
      kind: a.kind,
      models: [...a.models],
      customer_name: name,
      customer_phone: phone,
      slot_at: a.slot,
      reason: a.reason ? a.reason.slice(0, 300) : null,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error(`[sales/alert] could not record (${error?.code ?? "?"})`);
    return false;
  }
  const notified = await notifySalesPhone(alertSummary({ ...a, name, phone }));
  if (notified) {
    await sb.from("sales_alerts").update({ staff_notified: true }).eq("id", (data as { id: string }).id);
  }
  return true;
}

export async function listOpenAlerts(): Promise<SalesAlert[] | null> {
  const sb = channelDb();
  if (!sb) return null;
  const { data, error } = await sb
    .from("sales_alerts")
    .select("id, account_id, thread_id, kind, models, customer_name, customer_phone, slot_at, reason, status, created_at")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error || !Array.isArray(data)) return null;
  return data.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      accountId: String(r.account_id),
      threadId: String(r.thread_id),
      kind: r.kind as AlertKind,
      models: Array.isArray(r.models) ? (r.models as string[]) : [],
      customerName: typeof r.customer_name === "string" ? r.customer_name : null,
      customerPhone: typeof r.customer_phone === "string" ? r.customer_phone : null,
      slotAt: typeof r.slot_at === "string" ? new Date(r.slot_at).toISOString() : null,
      reason: typeof r.reason === "string" ? r.reason : null,
      status: "open",
      createdAt: new Date(String(r.created_at)).toISOString(),
    };
  });
}

export async function closeAlert(id: string, staffName: string): Promise<boolean> {
  const sb = channelDb();
  if (!sb || !/^[0-9a-f-]{36}$/i.test(id)) return false;
  const { error } = await sb
    .from("sales_alerts")
    .update({ status: "done", closed_at: new Date().toISOString(), closed_by: staffName.slice(0, 120) })
    .eq("id", id);
  return !error;
}

/** The 12-month rule for alerts (customer names and numbers), run by the daily clean-up. */
export async function purgeSalesAlerts(beforeIso: string): Promise<{ ok: boolean; removed: number }> {
  const sb = channelDb();
  if (!sb) return { ok: false, removed: 0 };
  const { data, error } = await sb.from("sales_alerts").delete().lt("created_at", beforeIso).select("id");
  if (error) return { ok: false, removed: 0 };
  await sb.from("test_drive_bookings").delete().lt("slot_at", beforeIso);
  return { ok: true, removed: Array.isArray(data) ? data.length : 0 };
}
