/**
 * Dhandho — the firm's daily learning session.
 *
 * Everyone meets Monday–Friday at 10:00 and Saturday at 10:30 (IST); one person
 * speaks each day. This file holds the calendar rules — when the meeting is and
 * when its reminder is due — so the page, the importer and the reminder worker
 * all agree. India has no daylight saving, so IST is a fixed +05:30 and plain
 * arithmetic is exact.
 */

const IST_OFFSET_MS = 330 * 60_000;

/** Reminder goes out this long before the session starts. */
export const REMINDER_LEAD_MIN = 30;
/** A reminder still goes out if the schedule was loaded this late (e.g. 9:50 for a 10:00 start). */
export const REMINDER_GRACE_MIN = 30;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(s: string): boolean {
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** 0 = Sunday … 6 = Saturday, for a calendar date. */
export function dayOfWeek(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The session's start time on that date, or null on Sunday (no session). */
export function meetingTime(iso: string): { hour: number; minute: number } | null {
  const dow = dayOfWeek(iso);
  if (dow === 0) return null;
  return dow === 6 ? { hour: 10, minute: 30 } : { hour: 10, minute: 0 };
}

/** When the session starts, as a real instant. */
export function meetingStart(iso: string): Date | null {
  const t = meetingTime(iso);
  if (!t) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, t.hour, t.minute) - IST_OFFSET_MS);
}

/** "10:00 am" / "10:30 am". */
export function meetingTimeLabel(iso: string): string | null {
  const t = meetingTime(iso);
  if (!t) return null;
  return `${t.hour}:${String(t.minute).padStart(2, "0")} am`;
}

/** The calendar date it is in India right now (or at `at`). */
export function istDate(at: Date = new Date()): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The span in which the reminder for `iso` should go out, or null on Sunday. */
export function reminderWindow(iso: string): { from: Date; to: Date } | null {
  const start = meetingStart(iso);
  if (!start) return null;
  return {
    from: new Date(start.getTime() - REMINDER_LEAD_MIN * 60_000),
    to: new Date(start.getTime() + REMINDER_GRACE_MIN * 60_000),
  };
}

/** Is it time to send the reminder for that session date? */
export function reminderDue(iso: string, now: Date = new Date()): boolean {
  const w = reminderWindow(iso);
  return !!w && now >= w.from && now <= w.to;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function dayName(iso: string): string {
  return DAY_NAMES[dayOfWeek(iso)];
}
