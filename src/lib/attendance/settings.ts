/**
 * Server-side loader for a tenant's attendance policy. Returns India defaults
 * when no row exists yet (settings are created lazily on first save).
 */

import { eq } from "drizzle-orm";
import { attendanceSettings } from "@/db/schema";
import { DEFAULT_ATTENDANCE_POLICY, type AttendancePolicy } from "./policy";

type Tx = { select: any };

export async function loadAttendancePolicy(tx: Tx, tenantId: string): Promise<AttendancePolicy> {
  const row = (
    await tx.select().from(attendanceSettings).where(eq(attendanceSettings.tenantId, tenantId)).limit(1)
  )[0];
  if (!row) return { ...DEFAULT_ATTENDANCE_POLICY };
  return {
    workStart: row.workStart ?? DEFAULT_ATTENDANCE_POLICY.workStart,
    workEnd: row.workEnd ?? DEFAULT_ATTENDANCE_POLICY.workEnd,
    graceMinutes: row.graceMinutes ?? DEFAULT_ATTENDANCE_POLICY.graceMinutes,
    halfDayMinutes: row.halfDayMinutes ?? DEFAULT_ATTENDANCE_POLICY.halfDayMinutes,
    fullDayMinutes: row.fullDayMinutes ?? DEFAULT_ATTENDANCE_POLICY.fullDayMinutes,
    weekOffDays: (row.weekOffDays as number[]) ?? DEFAULT_ATTENDANCE_POLICY.weekOffDays,
  };
}
