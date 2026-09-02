import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/trash
 *
 * JSON feed for the mobile Trash bin — soft-deleted clients + tasks, grouped,
 * role-gated exactly like the web /dashboard/trash page. Restore via the
 * existing /api/investors/{id}/restore and /api/tasks/{id}/restore endpoints.
 */

import { NextResponse } from "next/server";
import { and, desc, eq, isNotNull, or } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { investors, tasks } from "@/db/schema";
import { DEFAULT_SOFT_DELETE_RETENTION_DAYS } from "@/lib/platform/retention";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET() {
  try {
    const session = await requireSession();
    const canInvestors = can(session.roles, "investor.delete", session.permissions);
    const canTasksAll = can(session.roles, "task.edit.all", session.permissions);
    const canTasksOwn = can(session.roles, "task.edit.assigned", session.permissions);
    const canTasks = canTasksAll || canTasksOwn;
    const retention = DEFAULT_SOFT_DELETE_RETENTION_DAYS;
    const now = Date.now();

    const data = await withTenant(
      session.tenantId,
      async (tx) => {
        const invRows = canInvestors
          ? await tx
              .select({ id: investors.id, name: investors.name, pan: investors.pan, email: investors.email, phone: investors.phone, aum: investors.aum, deletedAt: investors.deletedAt })
              .from(investors)
              .where(and(eq(investors.tenantId, session.tenantId), isNotNull(investors.deletedAt)))
              .orderBy(desc(investors.deletedAt))
              .limit(500)
          : [];

        const taskScope = canTasksAll ? undefined : or(eq(tasks.assigneeId, session.userId), eq(tasks.createdById, session.userId));
        const taskRows = canTasks
          ? await tx
              .select({ id: tasks.id, title: tasks.title, type: tasks.type, status: tasks.status, priority: tasks.priority, deletedAt: tasks.deletedAt })
              .from(tasks)
              .where(and(eq(tasks.tenantId, session.tenantId), isNotNull(tasks.deletedAt), taskScope))
              .orderBy(desc(tasks.deletedAt))
              .limit(500)
          : [];

        return { invRows, taskRows };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    const investorsOut = data.invRows.map((r) => {
      const deletedAt = r.deletedAt ? new Date(r.deletedAt as any) : null;
      const daysLeft = deletedAt ? Math.max(0, retention - Math.floor((now - deletedAt.getTime()) / DAY_MS)) : retention;
      return {
        id: r.id,
        name: r.name,
        contact: r.email || r.phone || null,
        pan: r.pan || null,
        aum: r.aum != null ? Number(r.aum) : null,
        deletedAt: deletedAt ? deletedAt.toISOString() : null,
        daysLeft,
      };
    });

    const tasksOut = data.taskRows.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      status: r.status,
      deletedAt: r.deletedAt ? new Date(r.deletedAt as any).toISOString() : null,
    }));

    return NextResponse.json({
      retentionDays: retention,
      can: { investors: canInvestors, tasks: canTasks },
      investors: investorsOut,
      tasks: tasksOut,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
