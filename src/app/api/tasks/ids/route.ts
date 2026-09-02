import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/tasks/ids — every task id matching the CURRENT filters (not just the
 * visible page). Powers the list's "Select all N across all pages" option.
 * Mirrors the list's filter/scope logic; capped so a runaway selection can't
 * blow past the bulk endpoint's limit.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { tasks, users } from "@/db/schema";

export const dynamic = "force-dynamic";

const MAX_IDS = 500; // matches the bulk endpoint's per-call ceiling

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.view.all", "task.view.assigned"], session.permissions);
    const canViewAll = can(session.roles, "task.view.all", session.permissions);

    const url = new URL(req.url);
    const g = (k: string) => url.searchParams.get(k) ?? "";
    const csv = (v: string) => v.split(",").filter(Boolean);
    const q = g("q").trim();
    const statusFilter = csv(g("status"));
    const priorityFilter = csv(g("priority"));
    const deptFilter = csv(g("department"));
    const assigneeFilter = csv(g("assignee"));
    const tagsFilter = csv(g("tags"));
    const flagFilter = csv(g("flag"));
    const approval = g("approval");
    const dueFilter = csv(g("due"));
    const view = g("view");
    const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

    const out = await withTenant(session.tenantId, async (tx) => {
      const conds: any[] = [eq(tasks.tenantId, session.tenantId), isNull(tasks.deletedAt)];
      if (!canViewAll) conds.push(or(eq(tasks.assigneeId, session.userId), eq(tasks.createdById, session.userId))!);
      if (view === "to_me") conds.push(eq(tasks.assigneeId, session.userId));
      else if (view === "by_me") conds.push(eq(tasks.createdById, session.userId));
      if (statusFilter.length) conds.push(inArray(tasks.status, statusFilter as any));
      else if (!approval) conds.push(eq(tasks.status, "open"));
      if (approval === "pending") conds.push(eq(tasks.approvalStatus, "pending"));
      else if (approval === "mine") {
        conds.push(eq(tasks.approvalStatus, "pending"));
        if (!canViewAll) conds.push(eq(tasks.createdById, session.userId));
      }
      if (q) conds.push(or(ilike(tasks.title, `%${q}%`), ilike(tasks.description, `%${q}%`))!);
      if (priorityFilter.length) conds.push(inArray(tasks.priority, priorityFilter as any));
      if (deptFilter.length) conds.push(inArray(tasks.department, deptFilter as any));
      if (assigneeFilter.length) conds.push(inArray(tasks.assigneeId, assigneeFilter as any));
      if (tagsFilter.length) conds.push(sql`tasks.tags ?| ${tagsFilter}::text[]`);
      if (flagFilter.includes("requires_approval")) conds.push(eq(tasks.requiresApproval, true));
      if (flagFilter.includes("recurring")) conds.push(sql`tasks.recurrence is not null`);
      if (flagFilter.includes("has_attachments"))
        conds.push(sql`EXISTS (SELECT 1 FROM task_attachments a WHERE a.task_id = tasks.id AND a.deleted_at IS NULL)`);
      if (dueFilter.length) {
        const dc: any[] = [];
        if (dueFilter.includes("today")) dc.push(sql`due_at::date = current_date`);
        if (dueFilter.includes("overdue")) dc.push(sql`due_at < now()`);
        if (dueFilter.includes("sla_risk")) dc.push(sql`sla_due_at IS NOT NULL AND sla_due_at < now() + interval '24 hours'`);
        if (dc.length) conds.push(dc.length === 1 ? dc[0] : or(...dc)!);
      }
      for (const [key, col] of [["created", "created_at"], ["due", "due_at"]] as const) {
        const from = g(`${key}_from`);
        const to = g(`${key}_to`);
        if (isDate(from)) conds.push(sql`tasks.${sql.raw(col)} >= ${from}::date`);
        if (isDate(to)) conds.push(sql`tasks.${sql.raw(col)} < (${to}::date + interval '1 day')`);
      }

      const rows = await tx
        .select({ id: tasks.id })
        .from(tasks)
        .leftJoin(users, eq(users.id, tasks.assigneeId))
        .where(and(...conds) as any)
        .limit(MAX_IDS + 1);
      return rows.map((r) => r.id);
    });

    const capped = out.length > MAX_IDS;
    return NextResponse.json({ ids: out.slice(0, MAX_IDS), capped, limit: MAX_IDS });
  } catch (err: any) {
    return handleApiError(err);
  }
}
