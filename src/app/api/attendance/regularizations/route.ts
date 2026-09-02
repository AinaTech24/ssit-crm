import { handleApiError } from "@/lib/api/error-handler";
/**
 * Attendance regularizations — collection.
 *
 *   GET  /api/attendance/regularizations   — list (RLS-scoped). Managers see
 *                                             all; others see only their own.
 *   POST /api/attendance/regularizations   — file a correction request (self,
 *                                             or for a report if you're a
 *                                             manager).
 *
 * On create: notifies the applicant's reporting manager (or owners/branch-heads)
 * and audits. Mirrors the leave request workflow.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { attendanceRegularizations, users, notifications, ATTENDANCE_STATUSES } from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  employeeUserId: z.string().uuid().optional(),
  attendanceDate: z.string(), // YYYY-MM-DD
  requestedStatus: z.enum(ATTENDANCE_STATUSES).default("present"),
  requestedClockInAt: z.string().optional(), // "HH:MM"
  requestedClockOutAt: z.string().optional(), // "HH:MM"
  reason: z.string().max(2000).optional(),
});

/** Build a timestamptz from a YYYY-MM-DD date + "HH:MM" wall time in IST. */
function istTimestamp(attendanceDate: string, hhmm?: string): Date | null {
  if (!hhmm) return null;
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const d = new Date(`${attendanceDate}T${hhmm}:00+05:30`);
  return isNaN(d.getTime()) ? null : d;
}

export async function GET() {
  try {
    const session = await requireSession();
    const isManager = session.roles.some((r) => ["owner", "branch_head"].includes(r));
    const rows = await withTenant(session.tenantId, async (tx) => {
      const r = await tx.execute(sql`
        SELECT ar.id, ar.employee_user_id, ar.attendance_date, ar.requested_status,
               ar.requested_clock_in_at, ar.requested_clock_out_at, ar.reason,
               ar.status, ar.decision_notes, ar.decided_at, ar.created_at,
               u.name AS employee_name, rv.name AS reviewer_name
        FROM attendance_regularizations ar
        LEFT JOIN users u ON u.id = ar.employee_user_id
        LEFT JOIN users rv ON rv.id = ar.reviewer_user_id
        WHERE ar.tenant_id = ${session.tenantId}::uuid
          ${isManager ? sql`` : sql`AND ar.employee_user_id = ${session.userId}::uuid`}
        ORDER BY (ar.status = 'requested') DESC, ar.attendance_date DESC, ar.created_at DESC
        LIMIT 300
      `);
      return r.rows;
    });
    return NextResponse.json({ regularizations: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const body = parse.data;
    const clientMeta = clientMetaFromHeaders(req.headers);

    const isManager = session.roles.some((r) => ["owner", "branch_head"].includes(r));
    const employeeUserId = body.employeeUserId ?? session.userId;
    // Only managers may file on behalf of another employee.
    if (employeeUserId !== session.userId && !isManager) {
      return NextResponse.json({ error: "only a manager can file a correction for another employee" }, { status: 403 });
    }
    const attendanceDate = body.attendanceDate.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate)) {
      return NextResponse.json({ error: "invalid attendance date" }, { status: 400 });
    }
    const requestedClockInAt = istTimestamp(attendanceDate, body.requestedClockInAt);
    const requestedClockOutAt = istTimestamp(attendanceDate, body.requestedClockOutAt);
    if (requestedClockInAt && requestedClockOutAt && requestedClockOutAt < requestedClockInAt) {
      return NextResponse.json({ error: "clock-out is before clock-in" }, { status: 400 });
    }

    const id = uuid();
    const result = await withTenant(session.tenantId, async (tx) => {
      const emp = (await tx.select().from(users).where(and(eq(users.id, employeeUserId), eq(users.tenantId, session.tenantId))).limit(1))[0];
      if (!emp) throw Object.assign(new Error("employee not found"), { status: 404 });

      await tx.insert(attendanceRegularizations).values({
        id,
        tenantId: session.tenantId,
        employeeUserId,
        attendanceDate,
        requestedStatus: body.requestedStatus,
        requestedClockInAt,
        requestedClockOutAt,
        reason: body.reason ?? null,
        status: "requested",
      } as any);

      // Notify approvers: the reporting manager (if set) + owners/branch-heads.
      const approvers = await tx.execute(sql`
        SELECT id FROM users
        WHERE tenant_id = ${session.tenantId}::uuid
          AND (id = ${(emp as any).reportingManagerId ?? null} OR roles && ARRAY['owner','branch_head']::text[])
          AND id <> ${employeeUserId}
      `);
      for (const a of approvers.rows as Array<{ id: string }>) {
        await tx.insert(notifications).values({
          id: uuid(),
          tenantId: session.tenantId,
          userId: a.id,
          kind: "attendance.regularization.requested",
          title: `Attendance correction — ${emp.name}`,
          body: `${attendanceDate} · requested ${body.requestedStatus.replace(/_/g, " ")}`,
          linkUrl: "/dashboard/attendance/regularizations?status=requested",
          severity: "info",
          meta: { regularization_id: id, employee_user_id: employeeUserId } as any,
        } as any);
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "attendance.regularization.request",
        entityType: "attendance_regularization",
        entityId: id,
        after: { employeeUserId, attendanceDate, requestedStatus: body.requestedStatus } as any,
        ...clientMeta,
      });
      return { id };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
