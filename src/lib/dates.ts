/**
 * All business-date math goes through here. Times are stored in UTC; we
 * bucket and present in Asia/Kolkata.
 */

import { formatInTimeZone } from "date-fns-tz";
import { TIMEZONE } from "@/lib/config";

/** yyyy-MM-dd for "today" in IST. */
export function istToday(now: Date = new Date()): string {
  return formatInTimeZone(now, TIMEZONE, "yyyy-MM-dd");
}

/** yyyy-MM-dd for any Date in IST. */
export function istDate(d: Date): string {
  return formatInTimeZone(d, TIMEZONE, "yyyy-MM-dd");
}

/** Human-friendly "last synced" in IST, e.g. "8 Jun 2026, 18:04 IST". */
export function formatIstStamp(d: Date | null | undefined): string {
  if (!d) return "never";
  return formatInTimeZone(d, TIMEZONE, "d MMM yyyy, HH:mm 'IST'");
}

/** Subtract `days` from a yyyy-MM-dd IST date and return yyyy-MM-dd. */
export function istShiftDays(date: string, days: number): string {
  // Anchor at midnight IST for the date. IST is UTC+5:30, no DST.
  const d = new Date(`${date}T00:00:00+05:30`);
  d.setUTCDate(d.getUTCDate() + days);
  return formatInTimeZone(d, TIMEZONE, "yyyy-MM-dd");
}

/** Inclusive list of yyyy-MM-dd IST dates from `start` to `end`. */
export function istDateRange(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  // safety cap — we never need more than ~400 days
  for (let i = 0; i < 400 && cur <= end; i++) {
    out.push(cur);
    cur = istShiftDays(cur, 1);
  }
  return out;
}

/**
 * Returns the [start, end] (both yyyy-MM-dd, inclusive) of the IST week
 * that contains `date`, treating Monday as the first day.
 */
export function istWeekRange(date: string): { start: string; end: string } {
  const d = new Date(`${date}T00:00:00+05:30`);
  // 0 = Sun, 1 = Mon, ... — shift so Monday=0.
  const dow = (d.getUTCDay() + 6) % 7;
  const start = istShiftDays(date, -dow);
  const end = istShiftDays(start, 6);
  return { start, end };
}
