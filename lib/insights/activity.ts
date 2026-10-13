/**
 * Employees — PURE (Samer, 2026-10-13: "the employees and the amount of time spending on the app + the amount
 * of time working and also the amount of data or tasks being completed").
 *
 * Time is time ACTIVELY USING MONZA AI: the app window was visible AND used (a click, a key, a scroll, a
 * touch) in the last two minutes — measured a minute at a time (staff_activity_days, 028). It is not hours
 * worked: a salesperson on the phone or in the showroom is working and not in the app. The page says so.
 *
 * Tasks are what the records already say a person did, each counted where it happened: replies sent from
 * MONZA AI, leads taken and assigned, alerts closed, Decision Center items acted on, facts reviewed, lost
 * reasons and identity decisions recorded. Replies typed in the WhatsApp phone app carry no name and are
 * shown apart, never shared out.
 */

/** The app's sections a minute can be counted under (the first part of the address). Anything else: "other". */
export const SECTIONS = ["inbox", "customers", "insights", "automations", "installments", "test_drives", "sales", "chat", "dashboard", "integrations", "settings"] as const;
const SECTION_LABEL: Readonly<Record<string, string>> = {
  inbox: "Inbox",
  customers: "Customers",
  insights: "Insights",
  automations: "Automations",
  installments: "Installments",
  test_drives: "Test drives",
  sales: "Sales library",
  chat: "Assistant",
  dashboard: "Dashboard",
  integrations: "Integrations",
  settings: "Settings",
  other: "Other",
};
export const sectionLabel = (s: string) => SECTION_LABEL[s] ?? s;

/** Public pages are never counted (nobody is signed in there). */
const NOT_COUNTED = /^\/(login|care|install|car-care|offline)(\/|$)/;

/** The section of an address, or null when the page is not counted. */
export function sectionOf(pathname: string): string | null {
  if (NOT_COUNTED.test(pathname)) return null;
  const first = pathname.split("/")[1]?.toLowerCase().replace(/-/g, "_") ?? "";
  return (SECTIONS as readonly string[]).includes(first) ? first : "other";
}

/** Is the person using the app right now? Visible, and touched in the last `idleMs`. */
export function isActive(visible: boolean, lastInputMs: number, nowMs: number, idleMs = 120_000): boolean {
  return visible && nowMs - lastInputMs <= idleMs;
}

export interface ActivityDay {
  staff_id: string;
  day: string;
  staff_name: string | null;
  active_seconds: number;
  sections: Record<string, number> | null;
  first_at: string;
  last_at: string;
}

export type TaskKind = "replies_whatsapp" | "replies_meta" | "leads_taken" | "leads_assigned" | "alerts_closed" | "decisions" | "reviews" | "lost_reasons" | "identity";

export const TASK_LABEL: Readonly<Record<TaskKind, string>> = {
  replies_whatsapp: "WhatsApp replies sent from MONZA AI",
  replies_meta: "Instagram / Messenger replies sent from MONZA AI",
  leads_taken: "Leads taken",
  leads_assigned: "Leads assigned to others",
  alerts_closed: "Alerts closed",
  decisions: "Decision Center actions",
  reviews: "Facts reviewed",
  lost_reasons: "Lost reasons recorded",
  identity: "People joined or separated",
};

/** One thing a person did: by staff id when the record has it, else by name (alerts store a name). */
export interface TaskEvent {
  kind: TaskKind;
  staffId: string | null;
  staffName: string | null;
  at: string;
}

export interface EmployeeRow {
  key: string;
  name: string;
  activeMinutes: number;
  daysActive: number;
  /** Median minutes on a day they used the app. */
  minutesPerActiveDay: number | null;
  /** Median Beirut time of the first and last minute in the app ("08:42"). */
  typicalStart: string | null;
  typicalEnd: string | null;
  sections: { key: string; label: string; minutes: number }[];
  tasks: Partial<Record<TaskKind, number>>;
  tasksTotal: number;
  /** Tasks per active hour in the app; null under 30 minutes (too little to say). */
  tasksPerHour: number | null;
}

const beirutClock = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const minutesOfClock = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const clockOf = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/**
 * Everyone who used the app or did a recorded task in the period. A task recorded under a NAME only is
 * matched to the person whose app name is the same; otherwise it gets its own row under that name.
 */
export function employeesReport(days: readonly ActivityDay[], tasks: readonly TaskEvent[]): EmployeeRow[] {
  const rows = new Map<string, EmployeeRow & { starts: number[]; ends: number[]; perDay: number[]; sec: Map<string, number> }>();
  const nameToKey = new Map<string, string>();
  const row = (key: string, name: string) => {
    let r = rows.get(key);
    if (!r) {
      r = { key, name, activeMinutes: 0, daysActive: 0, minutesPerActiveDay: null, typicalStart: null, typicalEnd: null, sections: [], tasks: {}, tasksTotal: 0, tasksPerHour: null, starts: [], ends: [], perDay: [], sec: new Map() };
      rows.set(key, r);
    }
    if (name && (r.name === "Staff" || !r.name)) r.name = name;
    if (name) nameToKey.set(norm(name), key);
    return r;
  };
  for (const d of days) {
    const r = row(d.staff_id, d.staff_name ?? "Staff");
    const minutes = Math.round(d.active_seconds / 60);
    r.activeMinutes += minutes;
    if (minutes > 0) {
      r.daysActive++;
      r.perDay.push(minutes);
      r.starts.push(minutesOfClock(beirutClock(d.first_at)));
      r.ends.push(minutesOfClock(beirutClock(d.last_at)));
    }
    for (const [k, v] of Object.entries(d.sections ?? {})) r.sec.set(k, (r.sec.get(k) ?? 0) + Number(v || 0));
  }
  for (const t of tasks) {
    const key = t.staffId ?? nameToKey.get(norm(t.staffName)) ?? (t.staffName ? `name:${norm(t.staffName)}` : null);
    if (!key) continue;
    const r = row(key, t.staffName ?? "Staff");
    r.tasks[t.kind] = (r.tasks[t.kind] ?? 0) + 1;
    r.tasksTotal++;
  }
  return [...rows.values()]
    .map(({ starts, ends, perDay, sec, ...r }) => {
      const s = median(starts);
      const e = median(ends);
      return {
        ...r,
        minutesPerActiveDay: median(perDay),
        typicalStart: s === null ? null : clockOf(s),
        typicalEnd: e === null ? null : clockOf(e),
        sections: [...sec.entries()].map(([key, secs]) => ({ key, label: sectionLabel(key), minutes: Math.round(secs / 60) })).filter((x) => x.minutes > 0).sort((a, b) => b.minutes - a.minutes),
        tasksPerHour: r.activeMinutes >= 30 ? Math.round((r.tasksTotal / (r.activeMinutes / 60)) * 10) / 10 : null,
      };
    })
    .sort((a, b) => b.activeMinutes - a.activeMinutes || b.tasksTotal - a.tasksTotal || a.name.localeCompare(b.name));
}

/** Minutes per person per day, for the daily table (days oldest first). */
export function minutesByDay(days: readonly ActivityDay[], dayList: readonly string[]): { staffId: string; name: string; minutes: number[] }[] {
  const out = new Map<string, { staffId: string; name: string; minutes: number[] }>();
  const at = new Map(dayList.map((d, i) => [d, i]));
  for (const d of days) {
    const i = at.get(d.day);
    if (i === undefined) continue;
    const r = out.get(d.staff_id) ?? out.set(d.staff_id, { staffId: d.staff_id, name: d.staff_name ?? "Staff", minutes: dayList.map(() => 0) }).get(d.staff_id)!;
    r.minutes[i] += Math.round(d.active_seconds / 60);
  }
  return [...out.values()].sort((a, b) => b.minutes.reduce((x, y) => x + y, 0) - a.minutes.reduce((x, y) => x + y, 0));
}
