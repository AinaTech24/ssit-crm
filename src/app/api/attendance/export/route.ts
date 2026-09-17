import { handleApiError } from "@/lib/api/error-handler";
/**
 * Attendance — monthly CSV export (payroll).
 *
 *   GET /api/attendance/export?month=YYYY-MM
 *     — flat daily log + per-employee summary, as a downloadable CSV.
 *     — Managers only (owner / branch_head).
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { fmtMinutes, ATTENDANCE_STATUS_LABELS } from "@/lib/attendance/policy";

export const dynamic = "force-dynamic";

/** Shift a YYYY-MM month string by `delta` months. */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Escape one CSV field — wrap in quotes, double any internal quotes. */
function csv(value: unknown): string {
  const s = value == null ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

/** Format a timestamptz as IST "HH:MM" (or "" if absent). */
function istTime(ts: Date | string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!can(session.roles, "attendance.manage.all", session.permissions)) {
      return NextResponse.json({ error: "only a manager can export attendance" }, { status: 403 });
    }

    const now = new Date();
    const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const qMonth = req.nextUrl.searchParams.get("month");
    const month = qMonth && /^\d{4}-\d{2}$/.test(qMonth) ? qMonth : current;
    const monthStart = `${month}-01`;
    const monthEnd = `${shiftMonth(month, 1)}-01`;

    const rows = await withTenant(session.tenantId, async (tx) => {
      const r = await tx.execute(sql`
        SELECT
          u.name AS employee_name,
          u.email AS employee_email,
          a.attendance_date,
          a.status,
          a.clock_in_at,
          a.clock_out_at,
          a.total_minutes,
          a.source,
          a.note
        FROM attendance a
        LEFT JOIN users u ON u.id = a.employee_user_id
        WHERE a.tenant_id = ${session.tenantId}::uuid
          AND a.attendance_date >= ${monthStart}::date
          AND a.attendance_date < ${monthEnd}::date
        ORDER BY u.name NULLS LAST, a.attendance_date
      `);
      return r.rows as any[];
    });

    const lines: string[] = [];

    // Daily log
    lines.push(
      ["Employee", "Email", "Date", "Status", "Clock In", "Clock Out", "Worked (mins)", "Worked", "Source", "Note"]
        .map(csv)
        .join(",")
    );
    for (const r of rows) {
      const mins = r.total_minutes == null ? null : Number(r.total_minutes);
      lines.push(
        [
          r.employee_name ?? "",
          r.employee_email ?? "",
          r.attendance_date ? String(r.attendance_date).slice(0, 10) : "",
          ATTENDANCE_STATUS_LABELS[r.status] ?? r.status ?? "",
          istTime(r.clock_in_at),
          istTime(r.clock_out_at),
          mins == null ? "" : mins,
          fmtMinutes(mins),
          r.source ?? "",
          r.note ?? "",
        ]
          .map(csv)
          .join(",")
      );
    }

    // Per-employee summary
    type Sum = { email: string; present: number; halfDay: number; onLeave: number; absent: number; weekOff: number; holiday: number; minutes: number };
    const order: string[] = [];
    const byEmp = new Map<string, Sum>();
    for (const r of rows) {
      const name = r.employee_name ?? "";
      let s = byEmp.get(name);
      if (!s) {
        s = { email: r.employee_email ?? "", present: 0, halfDay: 0, onLeave: 0, absent: 0, weekOff: 0, holiday: 0, minutes: 0 };
        byEmp.set(name, s);
        order.push(name);
      }
      switch (r.status) {
        case "present": s.present++; break;
        case "half_day": s.halfDay++; break;
        case "on_leave": s.onLeave++; break;
        case "absent": s.absent++; break;
        case "week_off": s.weekOff++; break;
        case "holiday": s.holiday++; break;
      }
      if (r.total_minutes != null) s.minutes += Number(r.total_minutes);
    }

    lines.push("");
    lines.push(
      ["Employee", "Present", "Half-day", "On Leave", "Absent", "Week-off", "Holiday", "Total Worked"]
        .map(csv)
        .join(",")
    );
    for (const name of order) {
      const s = byEmp.get(name)!;
      lines.push(
        [name, s.present, s.halfDay, s.onLeave, s.absent, s.weekOff, s.holiday, fmtMinutes(s.minutes)]
          .map(csv)
          .join(",")
      );
    }

    const body = lines.join("\r\n");
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="attendance-${month}.csv"`,
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
