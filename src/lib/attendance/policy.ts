/**
 * Attendance policy + helpers (client-safe — pure data/functions).
 */

export const ATTENDANCE_STATUS_LABELS: Record<string, string> = {
  present: "Present",
  absent: "Absent",
  half_day: "Half day",
  week_off: "Week Off",
  holiday: "Holiday",
  on_leave: "On Leave",
};

/** Short cell label for the monthly grid. */
export const ATTENDANCE_STATUS_SHORT: Record<string, string> = {
  present: "P",
  absent: "A",
  half_day: "½",
  week_off: "WO",
  holiday: "H",
  on_leave: "L",
};

export const ATTENDANCE_STATUS_TONE: Record<string, string> = {
  present: "bg-emerald-50 text-emerald-700",
  absent: "bg-rose-50 text-rose-700",
  half_day: "bg-amber-50 text-amber-700",
  week_off: "bg-slate-100 text-slate-500",
  holiday: "bg-violet-50 text-violet-700",
  on_leave: "bg-blue-50 text-blue-700",
};

/** Default weekly off = Sunday (0). Tunable later via firm settings. */
export function isWeekOff(d: Date): boolean {
  return d.getDay() === 0;
}

/** Work-hours policy used to flag late-in / early-out + half days. */
export type AttendancePolicy = {
  workStart: string; // "HH:MM"
  workEnd: string; // "HH:MM"
  graceMinutes: number;
  halfDayMinutes: number;
  fullDayMinutes: number;
  weekOffDays: number[];
};

export const DEFAULT_ATTENDANCE_POLICY: AttendancePolicy = {
  workStart: "10:00",
  workEnd: "18:30",
  graceMinutes: 10,
  halfDayMinutes: 240,
  fullDayMinutes: 480,
  weekOffDays: [0],
};

/** Is weekday `dow` (0=Sun) a weekly off under this policy? */
export function isWeekOffDow(dow: number, weekOffDays: number[]): boolean {
  return (weekOffDays ?? [0]).includes(dow);
}

/**
 * Late-in / early-out flags for one day. Wall times are interpreted in IST
 * (+05:30) — this is an India product, so the explicit offset keeps the result
 * independent of the server's timezone.
 */
export function computeAttendanceFlags(
  attendanceDate: string, // "YYYY-MM-DD"
  clockInAt: Date | string | null | undefined,
  clockOutAt: Date | string | null | undefined,
  policy: AttendancePolicy
): { isLate: boolean; lateMinutes: number; isEarlyOut: boolean; earlyMinutes: number } {
  const inAt = clockInAt ? new Date(clockInAt) : null;
  const outAt = clockOutAt ? new Date(clockOutAt) : null;
  const grace = (policy.graceMinutes ?? 0) * 60000;
  const expectedStart = new Date(`${attendanceDate}T${policy.workStart}:00+05:30`);
  const expectedEnd = new Date(`${attendanceDate}T${policy.workEnd}:00+05:30`);

  let isLate = false;
  let lateMinutes = 0;
  if (inAt && !isNaN(expectedStart.getTime())) {
    const over = inAt.getTime() - (expectedStart.getTime() + grace);
    if (over > 0) {
      isLate = true;
      lateMinutes = Math.round(over / 60000);
    }
  }

  let isEarlyOut = false;
  let earlyMinutes = 0;
  if (outAt && !isNaN(expectedEnd.getTime())) {
    const under = expectedEnd.getTime() - grace - outAt.getTime();
    if (under > 0) {
      isEarlyOut = true;
      earlyMinutes = Math.round(under / 60000);
    }
  }
  return { isLate, lateMinutes, isEarlyOut, earlyMinutes };
}

/** Worked minutes between clock-in and clock-out (clamped ≥ 0). */
export function minutesBetween(clockIn: Date, clockOut: Date): number {
  const ms = clockOut.getTime() - clockIn.getTime();
  return ms > 0 ? Math.round(ms / 60000) : 0;
}

/** "4h 32m" / "—" from minutes. */
export function fmtMinutes(min: number | null | undefined): string {
  if (min == null || min <= 0) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
