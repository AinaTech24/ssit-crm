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
import { resolveDataScope, dataScopeSqlViaOwnerBranch } from "@/lib/auth/data-scope";
import { punchesOf, summarise } from "@/lib/attendance/punches";

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
      // Same wall as the attendance page: own sub-branch for a head, own row
      // for everyone else, the whole firm for admin / back office.
      const walled = dataScopeSqlViaOwnerBranch(await resolveDataScope(tx, session), "a.employee_user_id");
      const r = await tx.execute(sql`
        SELECT a.*, u.name AS employee_name
        FROM attendance a LEFT JOIN users u ON u.id = a.employee_user_id
        WHERE a.tenant_id = ${session.tenantId}::uuid AND ${walled}
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
    const clientMeta = clientMetaFromHeaders(req.headers);

    await withTenant(session.tenantId, async (tx) => {
      // A corrected time edits the day's first "in" / last "out"; any sessions in
      // between are kept, and the worked minutes are re-summed over all of them.
      const cur = await tx.execute(sql`
        SELECT punches, clock_in_at, clock_out_at, total_minutes FROM attendance
         WHERE tenant_id = ${session.tenantId}::uuid AND employee_user_id = ${employeeUserId}::uuid
           AND attendance_date = ${date}::date
         FOR UPDATE
      `);
      const punches = punchesOf(cur.rows[0]);
      if (clockInIso) {
        if (punches.length) punches[0].in = clockInIso;
        else punches.push({ in: clockInIso, out: null });
      }
      if (clockOutIso && punches.length) punches[punches.length - 1].out = clockOutIso;
      const s = summarise(punches);
      const hasPunches = punches.length > 0;
      await tx.execute(sql`
        INSERT INTO attendance (tenant_id, employee_user_id, attendance_date, status, note, punches, clock_in_at, clock_out_at, total_minutes, source)
        VALUES (${session.tenantId}::uuid, ${employeeUserId}::uuid, ${date}::date, ${status}, ${note ?? null},
                ${hasPunches ? JSON.stringify(punches) : null}::jsonb,
                ${s.clockInAt}::timestamptz, ${s.clockOutAt ?? clockOutIso}::timestamptz, ${s.totalMinutes}, 'manual')
        ON CONFLICT (tenant_id, employee_user_id, attendance_date) DO UPDATE SET
          status = EXCLUDED.status,
          note = COALESCE(EXCLUDED.note, attendance.note),
          punches = COALESCE(EXCLUDED.punches, attendance.punches),
          clock_in_at = COALESCE(EXCLUDED.clock_in_at, attendance.clock_in_at),
          clock_out_at = COALESCE(EXCLUDED.clock_out_at, attendance.clock_out_at),
          total_minutes = COALESCE(EXCLUDED.total_minutes, attendance.total_minutes),
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
