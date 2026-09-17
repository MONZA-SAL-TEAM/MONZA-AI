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

/**
 * Outside the showroom's hours (workbook B: Mon–Fri 08:00–18:00, Sat 08:00–14:00,
 * Sunday closed), a customer waiting for a person is told when the team is back.
 */
export function isAfterHours(nowIso: string): boolean {
  const ms = Date.parse(nowIso);
  if (!Number.isFinite(ms)) return false;
  const w = beirutTime(ms);
  const minutes = w.hour * 60 + w.minute;
  if (w.weekday === 0) return true;
  if (w.weekday === 6) return minutes < 8 * 60 || minutes >= 14 * 60;
  return minutes < 8 * 60 || minutes >= 18 * 60;
}

/* ── Typed times: "tomorrow at 3", "Saturday afternoon", "18 September at 4:30" ── */

export interface RequestedTime {
  /** The Beirut calendar day asked for. */
  year: number;
  month: number;
  day: number;
  /** Minutes from midnight when a time was given; null for "Saturday" or "afternoon". */
  minutes: number | null;
  /** "morning" / "afternoon" when only a part of the day was named. */
  part: "morning" | "afternoon" | null;
}

const DAY_WORDS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
  الاحد: 0, الأحد: 0, الاثنين: 1, الإثنين: 1, الثلاثاء: 2, الثلاثا: 2, الاربعاء: 3, الأربعاء: 3,
  الخميس: 4, الجمعة: 5, الجمعه: 5, السبت: 6,
};
const MONTH_WORDS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
};

function addDays(w: { year: number; month: number; day: number }, days: number): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(w.year, w.month - 1, w.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * The day and time a customer typed, in Beirut time, or null when the message
 * names none. Hours 1–8 with no am/pm are read as afternoon (test drives run
 * 10:00–17:00). Nothing here decides whether the slot exists or is free: that is
 * the engine's job with isBookableSlot / freeSlots.
 */
export function parseRequestedTime(text: string, nowIso: string): RequestedTime | null {
  const t = text
    .toLowerCase()
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[.,!?؟]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) return null;
  const today = beirutTime(nowMs);

  let day: { year: number; month: number; day: number } | null = null;
  if (/(^|\s)(after tomorrow|بعد بكرا)(\s|$)/.test(t)) day = addDays(today, 2);
  else if (/(^|\s)(today|اليوم|lyom)(\s|$)/.test(t)) day = today;
  else if (/(^|\s)(tomorrow|tmrw|tmr|بكرا|بكره|bukra|bokra)(\s|$)/.test(t)) day = addDays(today, 1);

  const words = t.split(" ");
  if (!day) {
    for (const w of words) {
      if (DAY_WORDS[w] !== undefined) {
        let ahead = (DAY_WORDS[w] - today.weekday + 7) % 7;
        if (ahead === 0) ahead = 7;
        day = addDays(today, ahead);
        break;
      }
    }
  }
  if (!day) {
    // "18 september", "september 18", "18/9", "18-09-2026"
    const dm = /(^|\s)(\d{1,2})[/\-](\d{1,2})(?:[/\-](\d{2,4}))?(\s|$)/.exec(t);
    const dName = /(^|\s)(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)(\s|$)/.exec(t);
    const nameD = /(^|\s)([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(\s|$)/.exec(t);
    if (dm && Number(dm[3]) >= 1 && Number(dm[3]) <= 12) {
      const year = dm[4] ? (dm[4].length === 2 ? 2000 + Number(dm[4]) : Number(dm[4])) : today.year;
      day = { year, month: Number(dm[3]), day: Number(dm[2]) };
    } else if (dName && MONTH_WORDS[dName[3]]) {
      day = { year: today.year, month: MONTH_WORDS[dName[3]], day: Number(dName[2]) };
    } else if (nameD && MONTH_WORDS[nameD[2]]) {
      day = { year: today.year, month: MONTH_WORDS[nameD[2]], day: Number(nameD[3]) };
    }
    if (day && Date.UTC(day.year, day.month - 1, day.day) < Date.UTC(today.year, today.month - 1, today.day)) {
      day = { ...day, year: day.year + 1 };
    }
  }

  // The time: "at 3", "3pm", "15:00", "4:30", "11am". A bare number is a time
  // only after "at" / "الساعة" or with am/pm, minutes or a 24-hour value.
  let minutes: number | null = null;
  const tm = /(?:(at|الساعة|el se3a|sa3a)\s*)?(?:^|\s)(\d{1,2})(?::(\d{2}))?\s?(am|pm|a m|p m|صباحا|مساء|بعد الظهر)?(?=\s|$)/g;
  let m: RegExpExecArray | null;
  while ((m = tm.exec(t)) !== null) {
    const h = Number(m[2]);
    const mm = Number(m[3] ?? 0);
    const explicit = Boolean(m[1] || m[3] || m[4]);
    const after = t.slice(m.index + m[0].length).trim().split(" ")[0];
    if (!explicit && (MONTH_WORDS[after] !== undefined || /^\d{4}$/.test(m[2]) || h < 9 || h > 23)) continue;
    if (h > 23 || mm > 59) continue;
    const suffix = (m[4] ?? "").replace(/\s/g, "");
    let hour = h;
    if (suffix === "pm" || suffix === "مساء" || suffix === "بعدالظهر") hour = h < 12 ? h + 12 : h;
    else if (suffix === "am" || suffix === "صباحا") hour = h === 12 ? 0 : h;
    else if (h >= 1 && h <= 8) hour = h + 12; // "at 3" is 15:00 in showroom hours
    minutes = hour * 60 + mm;
    break;
  }

  let part: RequestedTime["part"] = null;
  if (minutes === null) {
    if (/(^|\s)(morning|صبح|الصبح|صباح|sob7|sobo7)(\s|$)/.test(t)) part = "morning";
    else if (/(^|\s)(afternoon|noon|evening|العصر|المسا|مسا|3asr)(\s|$)/.test(t) || /بعد الظهر/.test(t)) part = "afternoon";
  }

  if (!day && minutes === null && part === null) return null;
  if (!day) {
    // A time with no day: today if it is still ahead, otherwise tomorrow.
    const nowMinutes = today.hour * 60 + today.minute;
    day = minutes !== null && minutes > nowMinutes + 60 ? today : addDays(today, 1);
  }
  return { year: day.year, month: day.month, day: day.day, minutes, part };
}

/** The slot starting at this Beirut wall-clock time, rounded down to the half hour, as UTC ISO. */
export function slotAtBeirut(day: { year: number; month: number; day: number }, minutes: number): string {
  const rounded = Math.floor(minutes / 30) * 30;
  return new Date(beirutToUtc(day.year, day.month, day.day, Math.floor(rounded / 60), rounded % 60)).toISOString();
}

/** The free slots of one Beirut day, optionally only its morning (before 13:00) or afternoon. */
export function freeSlotsOn(
  day: { year: number; month: number; day: number },
  nowIso: string,
  booked: readonly string[],
  part: "morning" | "afternoon" | null = null
): string[] {
  const now = Date.parse(nowIso);
  const taken = new Set(booked.map((b) => Date.parse(b)).filter(Number.isFinite));
  const weekday = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay();
  return slotsOfDay(day.year, day.month, day.day, weekday)
    .filter((ms) => ms >= now + 30 * 60_000 && !taken.has(ms))
    .filter((ms) => {
      if (!part) return true;
      const w = beirutTime(ms);
      return part === "morning" ? w.hour < 13 : w.hour >= 13;
    })
    .map((ms) => new Date(ms).toISOString());
}

/** "Wed 16 Sep" for a requested day. */
export function dayLabel(day: { year: number; month: number; day: number }): string {
  const weekday = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay();
  return `${DAY_NAMES[weekday]} ${day.day} ${MONTH_NAMES[day.month - 1]}`;
}
