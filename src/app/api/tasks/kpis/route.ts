/**
 * GET /api/tasks/kpis — the 4-card Tasks stats ribbon (mobile parity with the web
 * page): Open / Due today / Overdue / SLA-at-risk. Honours the SAME scope as the
 * list (view tab + search + priority/department/assignee + created range) so the
 * numbers move with the filters; each card pins status='open'.
 */

import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { tasks, users } from "@/db/schema";
import { taskKpiSelect, normalizeTaskKpis } from "@/lib/tasks/kpis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.view.all", "task.view.assigned"], session.permissions);
    const canViewAll = can(session.roles, "task.view.all", session.permissions);

    const url = new URL(req.url);
    const g = (k: string) => url.searchParams.get(k) ?? "";
    const csv = (v: string) => v.split(",").filter(Boolean);
    const q = g("q").trim();
    const view = g("view");
    const priorityFilter = csv(g("priority"));
    const deptFilter = csv(g("department"));
    const assigneeFilter = csv(g("assignee"));
    const createdFrom = g("created_from") || g("created");
    const createdTo = g("created_to") || g("created_end");
    const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

    const data = await withTenant(
      session.tenantId,
      async (tx) => {
        const conds: any[] = [eq(tasks.tenantId, session.tenantId), isNull(tasks.deletedAt)];
        if (!canViewAll) conds.push(or(eq(tasks.assigneeId, session.userId), eq(tasks.createdById, session.userId))!);
        if (view === "to_me") conds.push(eq(tasks.assigneeId, session.userId));
        else if (view === "by_me") conds.push(eq(tasks.createdById, session.userId));
        if (q) conds.push(or(ilike(tasks.title, `%${q}%`), ilike(tasks.description, `%${q}%`), ilike(users.name, `%${q}%`))!);
        if (priorityFilter.length) conds.push(inArray(tasks.priority, priorityFilter as any));
        if (deptFilter.length) conds.push(inArray(tasks.department, deptFilter as any));
        if (assigneeFilter.length) conds.push(inArray(tasks.assigneeId, assigneeFilter as any));
        if (isDate(createdFrom)) conds.push(sql`${tasks.createdAt} >= ${createdFrom}::date`);
        if (isDate(createdTo)) conds.push(sql`${tasks.createdAt} < (${createdTo}::date + interval '1 day')`);

        const r = await tx
          .select(taskKpiSelect)
          .from(tasks)
          .leftJoin(users, eq(users.id, tasks.assigneeId))
          .where(and(...conds) as any);
        return r[0] ?? {};
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    return NextResponse.json(normalizeTaskKpis(data));
  } catch (err) {
    return handleApiError(err);
  }
}
