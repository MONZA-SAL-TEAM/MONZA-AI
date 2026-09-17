/**
 * Test-drive slots (Samer's workbook, C Decisions, 2026-09-17): "create a calendar where we
 * can book individual test drives, and if a client books a time, don't let another client
 * have the same time. Test drives are Mon–Fri 10 to 5 and Sat 10 to 2." 30 minutes each.
 *
 * PURE: which slots exist and which are free. Holding a slot is the database's job — a
 * unique index on the booked slot (migration 014) — so two customers tapping the same
 * time at the same moment can never both get it, whatever this file believed.
 *
 * Times are Beirut wall-clock times, stored and passed as UTC ISO strings.
 */

export const SLOT_MINUTES = 30;
const TIME_ZONE = "Asia/Beirut";

/** Opening of the booking window per weekday (0 = Sunday), as [first start, end] in minutes. */
const WINDOWS: Readonly<Record<number, readonly [number, number] | null>> = {
  0: null,
  1: [10 * 60, 17 * 60],
  2: [10 * 60, 17 * 60],
  3: [10 * 60, 17 * 60],
  4: [10 * 60, 17 * 60],
  5: [10 * 60, 17 * 60],
  6: [10 * 60, 14 * 60],
};

interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});

/** A UTC instant as Beirut wall-clock time. */
export function beirutTime(ms: number): WallTime {
  const p: Record<string, string> = {};
  for (const part of PARTS.formatToParts(new Date(ms))) p[part.type] = part.value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    weekday: WEEKDAYS[p.weekday] ?? 0,
  };
}

/** A Beirut wall-clock time as a UTC instant (handles summer time). */
export function beirutToUtc(year: number, month: number, day: number, hour: number, minute: number): number {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wanted - 2 * 3_600_000;
  for (let i = 0; i < 3; i++) {
    const w = beirutTime(guess);
    const seen = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
    guess += wanted - seen;
  }
  return guess;
}

/** Every bookable slot start of one Beirut day, as UTC ms. */
function slotsOfDay(year: number, month: number, day: number, weekday: number): number[] {
  const window = WINDOWS[weekday];
  if (!window) return [];
  const out: number[] = [];
  for (let m = window[0]; m + SLOT_MINUTES <= window[1]; m += SLOT_MINUTES) {
    out.push(beirutToUtc(year, month, day, Math.floor(m / 60), m % 60));
  }
  return out;
}

/** Is this a real slot start (right day, right time, on the half hour)? */
export function isBookableSlot(iso: string): boolean {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return false;
  const w = beirutTime(ms);
  return slotsOfDay(w.year, w.month, w.day, w.weekday).includes(ms);
}

export interface FreeSlotOptions {
  /** How many days ahead to look, from today. */
  days?: number;
  /** How many slots to offer at most (a WhatsApp list holds 10). */
  max?: number;
  /** At most this many per day, so the offer spans several days. */
  perDay?: number;
  /** A slot must start at least this many minutes from now. */
  noticeMinutes?: number;
}

/** The next free slots, earliest first, as UTC ISO strings. */
export function freeSlots(nowIso: string, booked: readonly string[], opts: FreeSlotOptions = {}): string[] {
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) return [];
  const days = opts.days ?? 7;
  const max = opts.max ?? 10;
  const perDay = opts.perDay ?? 4;
  const notice = (opts.noticeMinutes ?? 120) * 60_000;
  const taken = new Set(booked.map((b) => Date.parse(b)).filter(Number.isFinite));

  const out: string[] = [];
  for (let d = 0; d <= days && out.length < max; d++) {
    const w = beirutTime(now + d * 86_400_000);
    let today = 0;
    for (const ms of slotsOfDay(w.year, w.month, w.day, w.weekday)) {
      if (out.length >= max || today >= perDay) break;
      if (ms < now + notice || taken.has(ms)) continue;
      out.push(new Date(ms).toISOString());
      today++;
    }
  }
  return out;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mon 22 Sep, 10:30" — short enough for a WhatsApp list row (24 characters). */
export function slotLabel(iso: string): string {
  const w = beirutTime(Date.parse(iso));
  const two = (n: number) => String(n).padStart(2, "0");
  return `${DAY_NAMES[w.weekday]} ${w.day} ${MONTH_NAMES[w.month - 1]}, ${two(w.hour)}:${two(w.minute)}`;
}
