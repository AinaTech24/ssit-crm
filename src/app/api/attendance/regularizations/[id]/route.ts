import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single attendance regularization.
 *
 *   PATCH  /api/attendance/regularizations/[id]   — { action: approve | reject | cancel, decisionNotes? }
 *
 * approve/reject: owner / branch_head, or the applicant's own reporting manager.
 * cancel: the applicant or a manager. State guard: approve/reject only from
 * 'requested'. On approve, the target day's attendance row is upserted to the
 * requested status / clock times. Decisions notify the applicant + are audited.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { attendance, attendanceRegularizations, notifications, users } from "@/db/schema";

export const dynamic = "force-dynamic";

const Patch = z.object({
  action: z.enum(["approve", "reject", "cancel"]),
  decisionNotes: z.string().max(2000).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const { action, decisionNotes } = parse.data;
    const clientMeta = clientMetaFromHeaders(req.headers);
    const isManager = session.roles.some((r) => ["owner", "branch_head"].includes(r));

    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(attendanceRegularizations).where(and(eq(attendanceRegularizations.id, id), eq(attendanceRegularizations.tenantId, session.tenantId))).limit(1))[0];
      if (!before) return { notFound: true as const };

      if (action === "approve" || action === "reject") {
        // Owner/branch_head can always decide; otherwise the applicant's own
        // reporting manager may decide (delegated approval).
        let canDecide = isManager;
        if (!canDecide) {
          const [applicant] = await tx
            .select({ mgr: users.reportingManagerId })
            .from(users)
            .where(eq(users.id, before.employeeUserId))
            .limit(1);
          canDecide = !!applicant?.mgr && applicant.mgr === session.userId;
        }
        if (!canDecide) return { forbidden: "Only a manager or the employee's reporting manager can approve or reject a correction." };
        if (before.status !== "requested") return { badState: `Cannot ${action} a ${before.status} request.` };

        const next = action === "approve" ? "approved" : "rejected";
        await tx
          .update(attendanceRegularizations)
          .set({ status: next, reviewerUserId: session.userId, decidedAt: new Date(), decisionNotes: decisionNotes ?? null, updatedAt: new Date() } as any)
          .where(eq(attendanceRegularizations.id, id));

        if (action === "approve") {
          // Upsert the target day's attendance row to the requested correction.
          const clockIn = before.requestedClockInAt ? new Date(before.requestedClockInAt) : null;
          const clockOut = before.requestedClockOutAt ? new Date(before.requestedClockOutAt) : null;
          const totalMinutes =
            clockIn && clockOut ? Math.max(0, Math.round((clockOut.getTime() - clockIn.getTime()) / 60000)) : null;

          await tx.insert(attendance).values({
            id: uuid(),
            tenantId: session.tenantId,
            employeeUserId: before.employeeUserId,
            attendanceDate: before.attendanceDate,
            status: before.requestedStatus,
            clockInAt: clockIn,
            clockOutAt: clockOut,
            totalMinutes,
            source: "manual",
          } as any).onConflictDoUpdate({
            target: [attendance.tenantId, attendance.employeeUserId, attendance.attendanceDate],
            set: {
              status: before.requestedStatus,
              ...(clockIn ? { clockInAt: clockIn } : {}),
              ...(clockOut ? { clockOutAt: clockOut } : {}),
              ...(totalMinutes != null ? { totalMinutes } : {}),
              source: "manual",
              updatedAt: new Date(),
            } as any,
          });
        }

        // Notify the applicant.
        await tx.insert(notifications).values({
          id: uuid(),
          tenantId: session.tenantId,
          userId: before.employeeUserId,
          kind: "attendance.regularization.decided",
          title: `Attendance correction ${next}`,
          body: `Your correction for ${before.attendanceDate} was ${next}.${decisionNotes ? ` Note: ${decisionNotes}` : ""}`,
          linkUrl: "/dashboard/attendance/regularizations?mine=1",
          severity: next === "approved" ? "success" : "warning",
          meta: { regularization_id: id } as any,
        } as any);
      } else {
        // cancel — applicant or manager; only while not already decided-final.
        if (before.employeeUserId !== session.userId && !isManager) {
          return { forbidden: "You can only cancel your own correction request." };
        }
        if (before.status === "rejected" || before.status === "cancelled") {
          return { badState: `Request is already ${before.status}.` };
        }
        await tx
          .update(attendanceRegularizations)
          .set({ status: "cancelled", updatedAt: new Date() } as any)
          .where(eq(attendanceRegularizations.id, id));
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: `attendance.regularization.${action}`,
        entityType: "attendance_regularization",
        entityId: id,
        before: { status: before.status } as any,
        after: { action, decisionNotes } as any,
        ...clientMeta,
      });
      return { ok: true as const };
    });

    if ((result as any).notFound) return NextResponse.json({ error: "not found" }, { status: 404 });
    if ((result as any).forbidden) return NextResponse.json({ error: (result as any).forbidden }, { status: 403 });
    if ((result as any).badState) return NextResponse.json({ error: (result as any).badState }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
