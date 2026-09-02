/**
 * Server-side working-day leave count. Loads the tenant's weekly-off days
 * (attendance_settings) + the holiday master in the requested range, then counts
 * the leave's working days (excluding both). This is the AUTHORITATIVE noOfDays
 * the API stores — the form shows a preview via /preview-days.
 */
import { sql } from "drizzle-orm";
import { loadAttendancePolicy } from "@/lib/attendance/settings";
import { workingDaysExcluding } from "./policy";

type Tx = { execute: (q: any) => Promise<{ rows: any[] }>; select: any };

export async function leaveWorkingDays(
  tx: Tx,
  tenantId: string,
  fromDate: string,
  toDate: string,
  duration: "full_day" | "half_day",
): Promise<number> {
  if (duration === "half_day") return 0.5;
  const policy = await loadAttendancePolicy(tx as any, tenantId);
  const hol = await tx.execute(sql`
    SELECT to_char(holiday_date, 'YYYY-MM-DD') AS d
    FROM holidays
    WHERE tenant_id = ${tenantId}::uuid AND holiday_date BETWEEN ${fromDate}::date AND ${toDate}::date
  `);
  const holidays = new Set((hol.rows as Array<{ d: string }>).map((r) => r.d));
  return workingDaysExcluding(fromDate, toDate, duration, policy.weekOffDays, holidays);
}
