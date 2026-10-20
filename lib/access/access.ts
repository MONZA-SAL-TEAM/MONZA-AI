/**
 * Team & access — PURE (Samer, 2026-10-13: "give roles to all the accounts … pages access and everything
 * control"). MONZA AI's own layer: the CRM's roles are not changed; this decides what each person may open and
 * do INSIDE MONZA AI. Only an admin (Samer) changes it.
 *
 *   No row          → MONZA AI as before: the CRM role decides (owners see everything; Insights needs
 *                     manage_team / view_reports; the inbox needs sales / manage_team).
 *   A row, admin    → everything, including this section.
 *   A row, blocked  → nothing in MONZA AI.
 *   A row           → exactly the pages and actions ticked (they may also open what the CRM role would not, e.g.
 *                     Insights for a salesperson — MONZA AI's own data; the CRM's own data stays behind the CRM's
 *                     permissions, which are untouched).
 *
 * Every page and every API route is checked on the server (requireStaff / requireStaffForPage); the side rail
 * hiding a link is a courtesy.
 */

export const PAGES = [
  { key: "inbox", href: "/inbox", label: "Inbox" },
  { key: "customers", href: "/customers", label: "Customers" },
  { key: "insights", href: "/insights", label: "Insights" },
  { key: "automations", href: "/automations", label: "Automations" },
  { key: "installments", href: "/installments", label: "Installments" },
  { key: "test_drives", href: "/test-drives", label: "Test drives" },
  { key: "sales", href: "/sales", label: "Sales library" },
  { key: "chat", href: "/chat", label: "AI assistant" },
  { key: "dashboard", href: "/dashboard", label: "Dashboard" },
  { key: "integrations", href: "/integrations", label: "Integrations" },
  { key: "settings", href: "/settings", label: "Settings" },
] as const;
export type PageKey = (typeof PAGES)[number]["key"];

export const ACTIONS = [
  { key: "send_messages", label: "Send messages and files", blurb: "Reply to customers on WhatsApp, Instagram and Messenger, and send suggested replies." },
  { key: "take_leads", label: "Take and release leads", blurb: "Take an unowned lead, release their own." },
  { key: "assign_leads", label: "Assign leads to others", blurb: "Give, move or release anyone's lead." },
  { key: "close_alerts", label: "Close alerts", blurb: "Mark a customer alert as done." },
  { key: "edit_insights", label: "Change Insights", blurb: "Review facts, decide car words, ad spend, lost reasons, join people, act in the Decision Center, start history reads." },
  { key: "manage_test_drives", label: "Manage test drives", blurb: "Book and cancel test drives." },
  { key: "edit_sales_library", label: "Edit the sales library", blurb: "Upload and remove brochures, photos and videos." },
] as const;
export type ActionKey = (typeof ACTIONS)[number]["key"];

const ALL_PAGES = PAGES.map((p) => p.key) as PageKey[];
const ALL_ACTIONS = ACTIONS.map((a) => a.key) as ActionKey[];

export type PresetKey = "full" | "manager" | "sales" | "viewer";
export const PRESETS: Readonly<Record<PresetKey, { label: string; blurb: string; pages: PageKey[]; actions: ActionKey[] }>> = {
  full: { label: "Full access", blurb: "Every page and every action.", pages: ALL_PAGES, actions: ALL_ACTIONS },
  manager: {
    label: "Sales manager",
    blurb: "Everything except Integrations and Settings.",
    pages: ALL_PAGES.filter((p) => p !== "integrations" && p !== "settings"),
    actions: ALL_ACTIONS,
  },
  sales: {
    label: "Salesperson",
    blurb: "Inbox, customers, test drives, the sales library and the assistant; replies, own leads, alerts, test drives.",
    pages: ["inbox", "customers", "test_drives", "sales", "chat"],
    actions: ["send_messages", "take_leads", "close_alerts", "manage_test_drives"],
  },
  viewer: { label: "View only", blurb: "Inbox and customers to read; no action.", pages: ["inbox", "customers"], actions: [] },
};

export interface AccessRow {
  userId: string;
  isAdmin: boolean;
  blocked: boolean;
  preset: string | null;
  pages: readonly string[];
  actions: readonly string[];
}

export interface EffectiveAccess {
  /** A row exists: the pages and actions below decide (unless admin). */
  restricted: boolean;
  admin: boolean;
  blocked: boolean;
  pages: readonly PageKey[];
  actions: readonly ActionKey[];
}

export const UNRESTRICTED: EffectiveAccess = { restricted: false, admin: false, blocked: false, pages: ALL_PAGES, actions: ALL_ACTIONS };

export function effectiveAccess(row: AccessRow | null): EffectiveAccess {
  if (!row) return UNRESTRICTED;
  if (row.isAdmin) return { restricted: false, admin: true, blocked: false, pages: ALL_PAGES, actions: ALL_ACTIONS };
  return {
    restricted: true,
    admin: false,
    blocked: row.blocked,
    pages: row.blocked ? [] : ALL_PAGES.filter((p) => row.pages.includes(p)),
    actions: row.blocked ? [] : ALL_ACTIONS.filter((a) => row.actions.includes(a)),
  };
}

/** The page a browser address belongs to; "admin" for this section; null for anything not controlled. */
export function pageKeyOf(pathname: string): PageKey | "admin" | null {
  const first = `/${pathname.split("/")[1] ?? ""}`;
  if (first === "/admin") return "admin";
  return PAGES.find((p) => p.href === first)?.key ?? null;
}

export interface ApiRule {
  /** The page the route serves; "any" = every signed-in person (their own settings, notifications). */
  page: PageKey | "admin" | "any";
  /** The action it performs, for a request that changes something. */
  action?: ActionKey;
  /** What is recorded for the person when they call it (a request that changes something). */
  event?: string;
}

const WRITE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * The rule for an API call. Null = not a staff route (webhooks, cron) — those check their own secret.
 * A test asserts every route under app/api has a rule or is listed as not a staff route.
 */
export function apiRuleOf(pathname: string, method: string): ApiRule | null {
  const p = pathname.replace(/\/+$/, "");
  const write = WRITE.has(method.toUpperCase());
  const is = (prefix: string) => p === prefix || p.startsWith(`${prefix}/`);
  if (is("/api/channels/meta") || is("/api/channels/retention") || is("/api/insights/catchup") || is("/api/insights/refresh")) return null;
  if (is("/api/admin/templates")) return { page: "admin", ...(write ? { event: "templates_changed" } : {}) };
  if (is("/api/admin")) return { page: "admin", ...(write ? { event: "access_changed" } : {}) };
  if (is("/api/me") || is("/api/push") || is("/api/status")) return { page: "any" };
  if (is("/api/channels/send")) return { page: "inbox", action: "send_messages", event: "message_sent" };
  if (is("/api/channels/templates")) return write ? { page: "inbox", action: "send_messages", event: "template_sent" } : { page: "inbox" };
  if (is("/api/channels/media")) return { page: "inbox", action: "send_messages", event: "file_upload" };
  if (is("/api/channels/diagnose")) return { page: "integrations" };
  if (is("/api/channels")) return { page: "inbox" };
  if (is("/api/chat")) return { page: "chat", ...(write ? { event: "assistant_question" } : {}) };
  if (is("/api/connections")) return { page: "integrations" };
  if (is("/api/conversations/owner")) return write ? { page: "inbox", action: "take_leads", event: "lead_owner_changed" } : { page: "inbox" };
  if (is("/api/conversations")) return { page: "inbox" };
  if (is("/api/insights")) return write ? { page: "insights", action: "edit_insights", event: `insights_${p.split("/")[3] ?? "change"}`.slice(0, 40) } : { page: "insights" };
  if (is("/api/sales/alerts")) return write ? { page: "inbox", action: "close_alerts", event: "alert_closed" } : { page: "inbox" };
  if (is("/api/sales/suggestion/send")) return { page: "inbox", action: "send_messages", event: "suggestion_sent" };
  if (is("/api/sales/suggestion") || is("/api/suggest")) return { page: "inbox" };
  if (is("/api/sales/test-drives")) return write ? { page: "test_drives", action: "manage_test_drives", event: "test_drive_changed" } : { page: "test_drives" };
  if (is("/api/wasales-media") || is("/api/whatsapp-sales")) return write ? { page: "sales", action: "edit_sales_library", event: "sales_library_changed" } : { page: "sales" };
  // Unknown: open to every signed-in person, as before — the route test makes sure nothing new slips by.
  return { page: "any" };
}

export function allowsPage(a: EffectiveAccess, page: PageKey | "admin" | "any" | null): boolean {
  if (a.admin) return true;
  if (page === "admin") return false;
  if (a.blocked) return false;
  if (!a.restricted || page === null || page === "any") return true;
  return a.pages.includes(page);
}

export function allowsRule(a: EffectiveAccess, rule: ApiRule): boolean {
  if (!allowsPage(a, rule.page)) return false;
  if (!rule.action || a.admin || !a.restricted) return true;
  return a.actions.includes(rule.action);
}

/** For a restricted person, what the lead-ownership rules see (lib/leads/ownership.ts). */
export function ownershipCapabilities(a: EffectiveAccess): string[] {
  return [...(a.actions.includes("take_leads") ? ["sales"] : []), ...(a.actions.includes("assign_leads") ? ["manage_team"] : [])];
}

/** Who is online: seen in the last 2 minutes; "active" when also used in that time. */
export function presenceOf(lastSeen: string | null, lastActive: string | null, nowMs: number): "active" | "open" | "offline" {
  if (!lastSeen || nowMs - Date.parse(lastSeen) > 150_000) return "offline";
  return lastActive && nowMs - Date.parse(lastActive) <= 150_000 ? "active" : "open";
}

export const EVENT_LABEL: Readonly<Record<string, string>> = {
  sign_in: "Signed in",
  message_sent: "Sent a message",
  file_upload: "Started sending a file",
  suggestion_sent: "Sent a suggested reply",
  lead_owner_changed: "Took, released or assigned a lead",
  alert_closed: "Closed an alert",
  test_drive_changed: "Booked or cancelled a test drive",
  sales_library_changed: "Changed the sales library",
  assistant_question: "Asked the AI assistant",
  access_changed: "Changed someone's access",
  template_sent: "Sent a WhatsApp template",
  templates_changed: "Changed the WhatsApp templates",
};

export function eventLabel(kind: string, detail: string | null): string {
  if (kind === "sign_in") return "Signed in";
  if (kind === "page") return `Opened ${PAGES.find((p) => p.key === detail)?.label ?? (detail === "admin" ? "Team & access" : detail ?? "a page")}`;
  if (kind === "refused") return `Tried something not allowed (${detail ?? "?"})`;
  if (detail?.startsWith("insights_")) return `Changed Insights (${detail.slice(9).replace(/_/g, " ")})`;
  return EVENT_LABEL[detail ?? ""] ?? (detail ?? "Action").replace(/_/g, " ");
}
