import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single leave application.
 *
 *   PATCH  /api/leave-applications/[id]   — { action: approve | reject | cancel, decisionNotes? }
 *
 * approve/reject: managers only (owner / branch_head). cancel: the applicant or
 * a manager. Decisions notify the applicant + are audited.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { resolveLeaveScope, loadLeaveApplicant, decideLeaveCheck, cancelLeaveCheck } from "@/lib/leave/access";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { leaveApplications, notifications, users } from "@/db/schema";

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

    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(leaveApplications).where(and(eq(leaveApplications.id, id), eq(leaveApplications.tenantId, session.tenantId))).limit(1))[0];
      if (!before) return { notFound: true as const };

      // One rule for who may act, shared with the list page and the list API —
      // see lib/leave/access.ts. It covers self-approval, the branch head's
      // sub-branch, a branch head's own request routing above the branch, and
      // delegated approval by a reporting manager.
      const scope = await resolveLeaveScope(tx, session);
      const applicant = await loadLeaveApplicant(tx, session.tenantId, before.employeeUserId);
      if (!applicant) return { notFound: true as const };

      if (action === "approve" || action === "reject") {
        const allowed = decideLeaveCheck(session, scope, applicant);
        if (!allowed.ok) return { forbidden: allowed.reason };
        if (before.status !== "requested") return { badState: `Cannot ${action} a ${before.status} request.` };
        const next = action === "approve" ? "approved" : "rejected";
        await tx
          .update(leaveApplications)
          .set({ status: next, approverUserId: session.userId, decidedAt: new Date(), decisionNotes: decisionNotes ?? null, updatedAt: new Date() } as any)
          .where(eq(leaveApplications.id, id));
        // Notify the applicant.
        await tx.insert(notifications).values({
          id: uuid(),
          tenantId: session.tenantId,
          userId: before.employeeUserId,
          kind: "leave.decided",
          title: `Leave ${next}`,
          body: `Your ${before.leaveType.replace(/_/g, " ")} leave (${before.fromDate}${before.toDate !== before.fromDate ? `–${before.toDate}` : ""}) was ${next}.${decisionNotes ? ` Note: ${decisionNotes}` : ""}`,
          linkUrl: "/dashboard/leave-applications?mine=1",
          severity: next === "approved" ? "success" : "warning",
          meta: { leave_id: id } as any,
        } as any);
      } else {
        // cancel — the applicant's own right, or anyone who could have decided
        // it; only while not already decided-final.
        const allowed = cancelLeaveCheck(session, scope, applicant);
        if (!allowed.ok) return { forbidden: allowed.reason };
        if (before.status === "rejected" || before.status === "cancelled") {
          return { badState: `Request is already ${before.status}.` };
        }
        await tx
          .update(leaveApplications)
          .set({ status: "cancelled", updatedAt: new Date() } as any)
          .where(eq(leaveApplications.id, id));
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: `leave.${action}`,
        entityType: "leave_application",
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

/**
 * DELETE /api/leave-applications/[id] — remove a leave application outright.
 *
 * Distinct from cancelling. Cancelling keeps the row and its history, which is
 * what you want for a request that was genuinely made and then withdrawn.
 * Deleting is for one that should never have existed — a duplicate, a wrong
 * employee, a test row — so it leaves nothing behind except the audit entry.
 *
 * Who: the applicant while it is still theirs to withdraw (not yet decided),
 * or anyone who could have decided it — the same rule as approve/reject, so a
 * branch head can tidy their own sub-branch and nobody else's.
 *
 * An APPROVED request is deliberately not deletable by the applicant: it has
 * already been counted against their balance and acted on, and making that
 * disappear is an admin's call, not the requester's.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const clientMeta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (
        await tx
          .select()
          .from(leaveApplications)
          .where(and(eq(leaveApplications.id, id), eq(leaveApplications.tenantId, session.tenantId)))
          .limit(1)
      )[0];
      if (!before) return { notFound: true as const };

      const scope = await resolveLeaveScope(tx, session);
      const applicant = await loadLeaveApplicant(tx, session.tenantId, before.employeeUserId);
      if (!applicant) return { notFound: true as const };

      const isMine = before.employeeUserId === session.userId;
      const canDecide = decideLeaveCheck(session, scope, applicant).ok;
      if (!canDecide && !isMine) {
        return { forbidden: "You can only delete your own leave requests." };
      }
      if (isMine && !canDecide && before.status === "approved") {
        return {
          forbidden: "An approved request can only be removed by an admin — ask them, or cancel it instead.",
        };
      }

      await tx
        .delete(leaveApplications)
        .where(and(eq(leaveApplications.id, id), eq(leaveApplications.tenantId, session.tenantId)));

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "leave.delete",
        entityType: "leave_application",
        entityId: id,
        before: {
          status: before.status,
          employeeUserId: before.employeeUserId,
          fromDate: before.fromDate,
          toDate: before.toDate,
          reason: before.reason,
        },
        ...clientMeta,
      });
      return { ok: true as const };
    });

    if ("notFound" in result) return NextResponse.json({ error: "not found" }, { status: 404 });
    if ("forbidden" in result) return NextResponse.json({ error: result.forbidden }, { status: 403 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
