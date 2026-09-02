/**
 * Attendance — clocking in and out of the WORK DAY.
 *
 * Not to be confused with the field-visit check-in (features/activities/
 * checkin.ts), which stamps a client visit. This is the RM's own day: one row
 * per person per date, with clock-in/out times, total minutes and an optional
 * GPS stamp — which matters for a field team who never see an office.
 *
 * POST /api/attendance/clock { action: "in" | "out", lat?, lng? }
 * GET  /api/attendance?limit=  → { attendance: rows }  (whole firm, RLS-scoped)
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { Tone } from "../../theme";

export type AttendanceStatus = "present" | "absent" | "half_day" | "week_off" | "holiday" | "on_leave";

export interface AttendanceRow {
  id: string;
  employee_user_id: string;
  employee_name: string | null;
  attendance_date: string; // YYYY-MM-DD
  status: AttendanceStatus | null;
  clock_in_at: string | null;
  clock_out_at: string | null;
  total_minutes: number | null;
  note: string | null;
  source: string | null;
  clock_in_lat: string | number | null;
  clock_in_lng: string | number | null;
  [k: string]: any;
}

export function useAttendance(limit = 120) {
  return useQuery({
    queryKey: ["attendance", limit],
    queryFn: () => api.get<{ attendance: AttendanceRow[] }>("/api/attendance", { limit: String(limit) }).then((r) => r.attendance),
    staleTime: 30_000,
  });
}

export interface ClockResult { ok?: boolean; clock_in_at?: string | null; clock_out_at?: string | null; total_minutes?: number | null; status?: string | null; error?: string }

export function useClock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { action: "in" | "out"; lat?: number; lng?: number }) => api.post<ClockResult>("/api/attendance/clock", v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attendance"] });
      qc.invalidateQueries({ queryKey: ["command-center"] });
    },
  });
}

// ── helpers ──

/** Local YYYY-MM-DD (never toISOString — it shifts the day in IST). */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The signed-in user's row for a given date, if any. */
export function findDay(rows: AttendanceRow[] | undefined, userId: string | undefined, date: string): AttendanceRow | undefined {
  if (!rows || !userId) return undefined;
  return rows.find((r) => r.employee_user_id === userId && String(r.attendance_date).slice(0, 10) === date);
}

/** Only this user's rows, newest first. */
export function myRows(rows: AttendanceRow[] | undefined, userId: string | undefined): AttendanceRow[] {
  if (!rows || !userId) return [];
  return rows.filter((r) => r.employee_user_id === userId);
}

/** "7h 24m" from minutes, or from a live clock-in when still running. */
export function durationLabel(row: AttendanceRow | undefined, now = Date.now()): string {
  if (!row) return "—";
  let mins = row.total_minutes ?? 0;
  if ((!mins || mins <= 0) && row.clock_in_at && !row.clock_out_at) {
    const started = new Date(row.clock_in_at).getTime();
    if (isFinite(started)) mins = Math.max(0, Math.round((now - started) / 60000));
  }
  if (!mins) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function timeLabel(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

export const STATUS_TONE: Record<string, Tone> = {
  present: "success", absent: "danger", half_day: "warning",
  week_off: "neutral", holiday: "info", on_leave: "violet",
};

/** Sum of minutes across rows — for the "this month" total. */
export const totalMinutes = (rows: AttendanceRow[]) => rows.reduce((n, r) => n + (r.total_minutes ?? 0), 0);
