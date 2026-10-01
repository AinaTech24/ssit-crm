import { handleApiError } from "@/lib/api/error-handler";
/**
 * Attendance — manager upsert.
 *
 *   GET   /api/attendance   — list (RLS-scoped)
 *   POST  /api/attendance   — upsert a row by (employee, date): set status/note.
 *                             Managers only (owner / branch_head).
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { ATTENDANCE_STATUSES } from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  employeeUserId: z.string().uuid(),
  date: z.string(), // YYYY-MM-DD
  status: z.enum(ATTENDANCE_STATUSES),
  note: z.string().max(500).optional(),
  // Manager-edited clock times (ISO). When set, the row's times + worked
  // minutes are corrected (e.g. fixing a missed punch).
  clockInAt: z.string().optional(),
  clockOutAt: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const url = new URL(req.url);
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 100));
    const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
    const rows = await withTenant(session.tenantId, async (tx) => {
      const r = await tx.execute(sql`
        SELECT a.*, u.name AS employee_name
        FROM attendance a LEFT JOIN users u ON u.id = a.employee_user_id
        WHERE a.tenant_id = ${session.tenantId}::uuid
        ORDER BY a.attendance_date DESC LIMIT ${limit} OFFSET ${offset}
      `);
      return r.rows;
    });
    return NextResponse.json({ attendance: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!can(session.roles, "attendance.manage.all", session.permissions)) {
      return NextResponse.json({ error: "only a manager can mark attendance" }, { status: 403 });
    }
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const { employeeUserId, status, note } = parse.data;
    const date = parse.data.date.slice(0, 10);
    const clockInIso = parse.data.clockInAt ? new Date(parse.data.clockInAt).toISOString() : null;
    const clockOutIso = parse.data.clockOutAt ? new Date(parse.data.clockOutAt).toISOString() : null;
    const totalMin =
      clockInIso && clockOutIso
        ? Math.max(0, Math.round((new Date(clockOutIso).getTime() - new Date(clockInIso).getTime()) / 60000))
        : null;
    const clientMeta = clientMetaFromHeaders(req.headers);

    await withTenant(session.tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO attendance (tenant_id, employee_user_id, attendance_date, status, note, clock_in_at, clock_out_at, total_minutes, source)
        VALUES (${session.tenantId}::uuid, ${employeeUserId}::uuid, ${date}::date, ${status}, ${note ?? null},
                ${clockInIso}::timestamptz, ${clockOutIso}::timestamptz, ${totalMin}, 'manual')
        ON CONFLICT (tenant_id, employee_user_id, attendance_date) DO UPDATE SET
          status = EXCLUDED.status,
          note = COALESCE(EXCLUDED.note, attendance.note),
          clock_in_at = COALESCE(EXCLUDED.clock_in_at, attendance.clock_in_at),
          clock_out_at = COALESCE(EXCLUDED.clock_out_at, attendance.clock_out_at),
          total_minutes = CASE
            WHEN COALESCE(EXCLUDED.clock_in_at, attendance.clock_in_at) IS NOT NULL
             AND COALESCE(EXCLUDED.clock_out_at, attendance.clock_out_at) IS NOT NULL
            THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM (
                 COALESCE(EXCLUDED.clock_out_at, attendance.clock_out_at) - COALESCE(EXCLUDED.clock_in_at, attendance.clock_in_at)
               )) / 60))::int
            ELSE attendance.total_minutes END,
          updated_at = now()
      `);
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "attendance.mark",
        entityType: "attendance",
        entityId: session.tenantId,
        after: { employeeUserId, date, status, clockInIso, clockOutIso } as any,
        ...clientMeta,
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}

/**
 * DELETE /api/attendance?employeeUserId=<uuid>&date=<yyyy-mm-dd>
 *
 * Clears one day's attendance mark, so the day reads as unmarked again rather
 * than carrying a wrong status.
 *
 * A row here is keyed (tenant, employee, date) and marking is an upsert, so a
 * WRONG status is fixed by marking again — this is for the day that should
 * have no record at all: someone marked on a holiday, or against the wrong
 * person. Same gate as marking; an employee cannot erase their own attendance.
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!can(session.roles, "attendance.manage.all", session.permissions)) {
      return NextResponse.json({ error: "only a manager can remove an attendance mark" }, { status: 403 });
    }
    const sp = req.nextUrl.searchParams;
    const employeeUserId = (sp.get("employeeUserId") ?? "").trim();
    const date = (sp.get("date") ?? "").slice(0, 10);
    if (!/^[0-9a-f-]{36}$/i.test(employeeUserId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "employeeUserId and date are required" }, { status: 400 });
    }
    const clientMeta = clientMetaFromHeaders(req.headers);

    const removed = await withTenant(session.tenantId, async (tx) => {
      const before = await tx.execute(sql`
        SELECT status, note FROM attendance
         WHERE tenant_id = ${session.tenantId}::uuid
           AND employee_user_id = ${employeeUserId}::uuid
           AND attendance_date = ${date}::date
         LIMIT 1
      `);
      if (before.rows.length === 0) return false;

      await tx.execute(sql`
        DELETE FROM attendance
         WHERE tenant_id = ${session.tenantId}::uuid
           AND employee_user_id = ${employeeUserId}::uuid
           AND attendance_date = ${date}::date
      `);
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "attendance.delete",
        entityType: "attendance",
        entityId: session.tenantId,
        before: { employeeUserId, date, ...(before.rows[0] as Record<string, unknown>) },
        ...clientMeta,
      });
      return true;
    });

    if (!removed) return NextResponse.json({ error: "no attendance marked for that day" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
