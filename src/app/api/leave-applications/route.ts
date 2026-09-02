import { handleApiError } from "@/lib/api/error-handler";
/**
 * Leave applications — collection.
 *
 *   GET  /api/leave-applications   — list (RLS-scoped)
 *   POST /api/leave-applications   — file a leave request (self, or for a
 *                                    report if you're a manager)
 *
 * On create: computes working days, notifies the applicant's reporting manager
 * (or owners/branch-heads), emits a `leave.requested` event, and audits.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { leaveApplications, users, notifications, eventsOutbox, LEAVE_TYPES, LEAVE_DURATIONS } from "@/db/schema";
import { leaveWorkingDays } from "@/lib/leave/working-days";

export const dynamic = "force-dynamic";

const Body = z.object({
  employeeUserId: z.string().uuid().optional(),
  leaveType: z.enum(LEAVE_TYPES),
  duration: z.enum(LEAVE_DURATIONS).default("full_day"),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fromDate must be YYYY-MM-DD"),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "toDate must be YYYY-MM-DD"),
  reason: z.string().max(2000).optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    // Leave reasons are HR-sensitive (medical / bereavement / personal), so the
    // list is scoped: owners + branch-heads see the whole firm; everyone else
    // sees only their own applications plus those of their direct reports.
    const isManager = session.roles.some((r) => ["owner", "branch_head"].includes(r));
    const rows = await withTenant(session.tenantId, async (tx) => {
      const scope = isManager
        ? sql``
        : sql` AND (
            la.employee_user_id = ${session.userId}::uuid
            OR la.employee_user_id IN (
              SELECT id FROM users
              WHERE tenant_id = ${session.tenantId}::uuid AND reporting_manager_id = ${session.userId}::uuid
            )
          )`;
      const r = await tx.execute(sql`
        SELECT la.*, u.name AS employee_name, a.name AS approver_name
        FROM leave_applications la
        LEFT JOIN users u ON u.id = la.employee_user_id
        LEFT JOIN users a ON a.id = la.approver_user_id
        WHERE la.tenant_id = ${session.tenantId}::uuid${scope}
        ORDER BY la.created_at DESC
        LIMIT 500
      `);
      return r.rows;
    });
    return NextResponse.json({ leaveApplications: rows });
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
      return NextResponse.json({ error: "only a manager can file leave for another employee" }, { status: 403 });
    }
    const fromDate = body.fromDate.slice(0, 10);
    const toDate = (body.duration === "half_day" ? body.fromDate : body.toDate).slice(0, 10);
    if (toDate < fromDate) {
      return NextResponse.json({ error: "to-date is before from-date" }, { status: 400 });
    }

    const id = uuid();
    const result = await withTenant(session.tenantId, async (tx) => {
      const emp = (await tx.select().from(users).where(and(eq(users.id, employeeUserId), eq(users.tenantId, session.tenantId))).limit(1))[0];
      if (!emp) throw Object.assign(new Error("employee not found"), { status: 404 });

      // Reject a request that overlaps an existing live (requested/approved) one
      // for the same employee — two overlapping ranges satisfy from <= toDate AND
      // to >= fromDate. Stops accidental duplicate / double-booked leave.
      const overlap = await tx.execute(sql`
        SELECT 1 FROM leave_applications
        WHERE tenant_id = ${session.tenantId}::uuid
          AND employee_user_id = ${employeeUserId}::uuid
          AND status IN ('requested', 'approved')
          AND from_date <= ${toDate}::date AND to_date >= ${fromDate}::date
        LIMIT 1
      `);
      if (overlap.rows.length) {
        throw Object.assign(new Error("This employee already has a pending or approved leave overlapping these dates."), { status: 409 });
      }

      // Authoritative working-day count — excludes the firm's weekly-offs +
      // holidays so a weekend/festival-spanning leave isn't over-charged.
      const days = await leaveWorkingDays(tx as any, session.tenantId, fromDate, toDate, body.duration);

      await tx.insert(leaveApplications).values({
        id,
        tenantId: session.tenantId,
        employeeUserId,
        leaveType: body.leaveType,
        duration: body.duration,
        fromDate,
        toDate,
        noOfDays: String(days),
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
          kind: "leave.requested",
          title: `Leave request — ${emp.name}`,
          body: `${days} day(s) · ${body.leaveType.replace(/_/g, " ")} · ${fromDate}${toDate !== fromDate ? `–${toDate}` : ""}`,
          linkUrl: "/dashboard/leave-applications?status=requested",
          severity: "info",
          meta: { leave_id: id, employee_user_id: employeeUserId } as any,
        } as any);
      }

      await tx.insert(eventsOutbox).values({
        tenantId: session.tenantId,
        kind: "leave.requested",
        entityType: "leave_application",
        entityId: id,
        after: { employeeUserId, leaveType: body.leaveType, fromDate, toDate, days } as any,
        meta: { userId: session.userId } as any,
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "leave.request",
        entityType: "leave_application",
        entityId: id,
        after: { employeeUserId, leaveType: body.leaveType, fromDate, toDate, days } as any,
        ...clientMeta,
      });
      return { id, days };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
