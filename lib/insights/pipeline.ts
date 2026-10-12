/**
 * Connections & Data Pipeline Health — PURE (Samer, 2026-10-12: "explicitly distinguish connected and
 * working / connected but no data / not started / running / partial / invalid authorization /
 * insufficient permissions / rate-limited / database failure / recognition failure / unknown", and
 * "never convert database errors or API failures into a displayed zero"). The read is
 * lib/insights/pipeline-server.ts; tested in tests/insights-pipeline.test.ts.
 *
 * Three questions per account, answered separately because they fail separately (CLAUDE.md rule 23):
 *   live      are new customer messages arriving (webhook → stored)?
 *   history   has the past been read?
 *   labels    is what arrives being read into labels?
 */

export type HealthState =
  | "working"
  | "connected_no_data"
  | "not_started"
  | "running"
  | "partial"
  | "auth_invalid"
  | "permissions"
  | "rate_limited"
  | "database_failure"
  | "recognition_failure"
  | "no_key"
  | "not_supported"
  | "unknown";

export const HEALTH_LABEL: Readonly<Record<HealthState, string>> = {
  working: "Connected and working",
  connected_no_data: "Connected, no data yet",
  not_started: "Not started",
  running: "Running",
  partial: "Partly done — continue",
  auth_invalid: "Key expired or invalid",
  permissions: "Missing a Meta permission",
  rate_limited: "Paused by Meta's rate limit",
  database_failure: "Database could not be read",
  recognition_failure: "Messages arriving but not being read",
  no_key: "No access key set",
  not_supported: "Not available from Meta",
  unknown: "Unknown",
};

/** Good, neutral, needs action — for the status dot. */
export const HEALTH_TONE: Readonly<Record<HealthState, "good" | "neutral" | "bad">> = {
  working: "good",
  connected_no_data: "neutral",
  not_started: "neutral",
  running: "neutral",
  partial: "neutral",
  auth_invalid: "bad",
  permissions: "bad",
  rate_limited: "neutral",
  database_failure: "bad",
  recognition_failure: "bad",
  no_key: "bad",
  not_supported: "neutral",
  unknown: "neutral",
};

/** A stop code from the history read (meta-backfill) as a state. */
export function stateOfCode(code: string | null): HealthState {
  if (!code) return "unknown";
  if (code === "meta_190" || code.startsWith("meta_190_") || code === "meta_102") return "auth_invalid";
  if (/^meta_(10|200|3)(_|$)/.test(code) || code === "empty_first_page") return "permissions";
  if (/^meta_(4|17|32|613)(_|$)/.test(code) || code === "usage_over_75" || code === "call_budget") return "rate_limited";
  if (code === "no_token") return "no_key";
  if (code === "not_connected" || code === "no_page") return "auth_invalid";
  return "unknown";
}

export interface PipelineCounts {
  conversations: number;
  customerMessages: number;
  ourMessages: number;
  lastCustomerMessage: string | null;
  lastOurMessage: string | null;
  labelled: number;
  lastLabelled: string | null;
  facts: number;
  unlabelledSinceRebuild: number;
  unlabelledBefore: number;
  testMessages: number;
}

export interface AccountInput {
  id: string;
  channel: string;
  brand: string;
  label: string;
  externalId: string;
  connectedAt: string | null;
  keySet: boolean;
  /** Instagram: the Instagram-login key (rule 49) is set — the route that can list conversations. */
  instagramLoginKey: boolean;
  counts: PipelineCounts | null;
  /** History read (insight_backfill_runs): state and stop code. */
  run: { state: string; code: string | null; threads: number; signals: number; updatedAt: string | null } | null;
  /** WhatsApp's own history read (wa:rebuild). */
  whatsappRebuild?: { state: string | null; finishedAt: string | null } | null;
}

export interface AccountHealth {
  id: string;
  channel: string;
  brand: string;
  label: string;
  externalId: string;
  live: { state: HealthState; detail: string };
  history: { state: HealthState; detail: string };
  labels: { state: HealthState; detail: string };
  permissions: string;
  historySupport: string;
  counts: PipelineCounts | null;
  run: AccountInput["run"];
}

const PERMISSIONS: Readonly<Record<string, string>> = {
  whatsapp: "whatsapp_business_messaging (system user MONZA AI Sender); webhook fields messages + smb_message_echoes",
  instagram: "Instagram login: instagram_business_basic + instagram_business_manage_messages; or Facebook login: instagram_basic + instagram_manage_messages",
  facebook: "pages_messaging + pages_read_engagement + pages_show_list (Page token)",
};

const HISTORY_SUPPORT: Readonly<Record<string, string>> = {
  whatsapp: "Only what arrived since the number was connected (2026-09-15) — the WhatsApp Cloud API cannot list older chats. Stored for 12 months.",
  instagram: "Read from Meta: each conversation's latest 20 messages, labels only.",
  facebook: "Read from Meta: each conversation's latest messages, labels only.",
};

const HOUR = 3_600_000;

export function accountHealth(a: AccountInput, nowMs: number): AccountHealth {
  const c = a.counts;
  const age = (iso: string | null) => (iso ? nowMs - Date.parse(iso) : Infinity);

  // Live: new messages arriving.
  let live: AccountHealth["live"];
  if (!c) live = { state: "database_failure", detail: "The counts could not be read." };
  else if (!a.keySet && !a.instagramLoginKey) live = { state: "no_key", detail: "No access key is set for this account in Vercel." };
  else if (c.customerMessages + c.testMessages === 0)
    live = {
      state: "connected_no_data",
      detail: a.channel === "instagram" ? "No Instagram message has ever arrived through the webhook (CLAUDE.md rule 43). The inbox still reads Instagram live from Meta." : "No customer message has been stored yet.",
    };
  else if (age(c.lastCustomerMessage) < 48 * HOUR) live = { state: "working", detail: "Customer messages are arriving." };
  else live = { state: "connected_no_data", detail: "Messages have arrived before, none in the last 48 hours." };

  // History.
  let history: AccountHealth["history"];
  if (a.channel === "whatsapp") {
    const r = a.whatsappRebuild;
    history = !r || !r.state
      ? { state: "not_started", detail: "The stored WhatsApp history has not been read yet." }
      : r.state === "done"
        ? { state: "working", detail: "Stored history read." }
        : { state: "partial", detail: "The history read stopped part-way; press it again to continue." };
  } else if (!a.run || a.run.state === "not_started") history = { state: "not_started", detail: "Not read yet — press Count first, then Read history." };
  else if (a.run.state === "done") history = { state: "working", detail: `Read: ${a.run.threads} conversations, ${a.run.signals} customer messages. Refreshed nightly.` };
  else if (a.run.state === "running") history = { state: "running", detail: `${a.run.threads} conversations so far.` };
  else {
    const s = stateOfCode(a.run.code);
    history = { state: s === "unknown" ? "partial" : s, detail: `Stopped${a.run.code ? ` (${a.run.code})` : ""} after ${a.run.threads} conversations.` };
  }

  // Labels: what arrives is read.
  let labels: AccountHealth["labels"];
  if (!c) labels = { state: "database_failure", detail: "The counts could not be read." };
  else if (c.customerMessages === 0) labels = { state: "connected_no_data", detail: "Nothing to read yet." };
  else if (c.unlabelledSinceRebuild > 0 && age(c.lastCustomerMessage) > 15 * 60_000 && (c.lastLabelled === null || Date.parse(c.lastLabelled) < Date.parse(c.lastCustomerMessage ?? "1970-01-01")))
    labels = { state: "recognition_failure", detail: `${c.unlabelledSinceRebuild} customer messages since the last history read have no labels.` };
  else if (c.labelled === 0)
    labels = {
      state: a.channel === "whatsapp" ? "not_started" : "not_started",
      detail: a.channel === "whatsapp" ? "Read the WhatsApp history to label what is stored." : "These arrived before labels were recorded; Instagram/Facebook words are not stored, so only the history read can label them.",
    };
  else labels = { state: "working", detail: `${c.labelled} of ${c.customerMessages} customer messages labelled; ${c.unlabelledBefore} left out by the engine (scams, vendors, empty).` };

  return {
    id: a.id,
    channel: a.channel,
    brand: a.brand,
    label: a.label,
    externalId: a.externalId,
    live,
    history,
    labels,
    permissions: PERMISSIONS[a.channel] ?? "",
    historySupport: HISTORY_SUPPORT[a.channel] ?? "",
    counts: c,
    run: a.run,
  };
}
