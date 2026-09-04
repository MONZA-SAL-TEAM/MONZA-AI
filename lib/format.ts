/**
 * Display formatting, shared by every screen.
 *
 * Everything here is PURE and locale-free on purpose. `Intl` and `toLocaleString`
 * give different answers on the server and in the browser, which React reports
 * as a hydration error and a person experiences as text flickering. Fixed rules
 * produce the same string everywhere.
 */

/** "$1,550" — or "$1,550.30" when the cents matter. */
export function usd(n: number): string {
  const cents = Math.round(n * 100);
  const whole = Math.trunc(cents / 100);
  const frac = Math.abs(cents % 100);
  const grouped = String(Math.abs(whole)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = cents < 0 ? "-" : "";
  return frac === 0
    ? `${sign}$${grouped}`
    : `${sign}$${grouped}.${String(frac).padStart(2, "0")}`;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-08-27" -> "27 August 2026". Returns the input if it is not a date. */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number.parseInt(m[2], 10) - 1];
  if (!month) return iso;
  return `${Number.parseInt(m[3], 10)} ${month} ${m[1]}`;
}

/** "2026-08-27" -> "27 Aug". For dense lists. */
export function shortDate(iso: string): string {
  const long = longDate(iso);
  if (long === iso) return iso;
  const [day, month, year] = long.split(" ");
  return `${day} ${month.slice(0, 3)} ${year}`;
}

/**
 * How a message time reads in a thread list, given the day it is being read on.
 * Both are parameters — this module never reads a clock, so the server and the
 * browser always agree.
 */
export function messageTime(isoTimestamp: string, today: string): string {
  const day = isoTimestamp.slice(0, 10);
  const time = isoTimestamp.slice(11, 16);
  if (day === today) return time;

  const yesterday = shiftDays(today, -1);
  if (day === yesterday) return "Yesterday";
  return shortDate(day);
}

/** ISO date plus/minus whole days. UTC only, so no daylight-saving surprises. */
export function shiftDays(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

/** "3 days", "1 day", "today" — for describing a gap without a clock. */
export function dayCount(n: number): string {
  const abs = Math.abs(n);
  if (abs === 0) return "today";
  return abs === 1 ? "1 day" : `${abs} days`;
}

/** First name only, the way a person writes to another person. */
export function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] || full;
}

/**
 * A WhatsApp deep link with the message prefilled. NOTHING is sent until a
 * person taps send — every button built on this must say so, because until the
 * WhatsApp Business API is connected a human being is the sending mechanism.
 */
export function waLink(phoneDigits: string, text: string): string {
  const digits = phoneDigits.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
