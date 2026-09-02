import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/tasks/bulk — apply one action to many tasks at once.
 *
 * Body: { ids: string[], action, value? }
 *   action = "status"    value = open|in_progress|blocked|completed|cancelled
 *          = "priority"  value = low|normal|high|urgent
 *          = "assign"    value = userId (uuid)
 *          = "cancel"    (no value) → status = cancelled
 *
 * RBAC: task.edit.all updates any task in the tenant; task.edit.assigned users
 * may only bulk-edit tasks they own (assignee or creator) — enforced in the
 * WHERE clause so it can never touch someone else's task. Audited once.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { spawnNextOccurrence } from "@/lib/tasks/recurrence";
import { tasks, users } from "@/db/schema";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const Body = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(["status", "priority", "assign", "cancel", "delete", "reschedule"]),
  value: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.edit.all", "task.edit.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { ids, action, value } = parsed.data;
    const canEditAll = can(session.roles, "task.edit.all", session.permissions);
    const meta = clientMetaFromHeaders(req.headers);

    // Build the column patch from the requested action.
    const patch: Record<string, any> = { updatedAt: new Date() };
    if (action === "cancel") {
      patch.status = "cancelled";
    } else if (action === "status") {
      const ok = ["open", "in_progress", "blocked", "completed", "cancelled"];
      if (!value || !ok.includes(value)) return NextResponse.json({ error: "invalid status" }, { status: 400 });
      patch.status = value;
      if (value === "completed") patch.completedAt = new Date();
    } else if (action === "priority") {
      const ok = ["low", "normal", "high", "urgent"];
      if (!value || !ok.includes(value)) return NextResponse.json({ error: "invalid priority" }, { status: 400 });
      patch.priority = value;
    } else if (action === "reschedule") {
      const d = value ? new Date(value) : null;
      if (!d || isNaN(d.getTime())) return NextResponse.json({ error: "invalid date" }, { status: 400 });
      patch.dueAt = d;
      // A rescheduled task should re-arm its overdue alert.
      patch.overdueNotifiedAt = null;
    } else if (action === "assign") {
      if (!value) return NextResponse.json({ error: "value (userId) required" }, { status: 400 });
      if (!UUID_RE.test(value)) return NextResponse.json({ error: "value must be a user id" }, { status: 400 });
    }

    const count = await withTenant(session.tenantId, async (tx) => {
      // A reassignment target must be a user in THIS tenant.
      if (action === "assign") {
        const [u] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, value!), eq(users.tenantId, session.tenantId)))
          .limit(1);
        if (!u) throw Object.assign(new Error("assignee not found in this firm"), { status: 400 });
        patch.assigneeId = value;
      }

      // Exclude already-trashed tasks from every bulk action.
      const conds: any[] = [eq(tasks.tenantId, session.tenantId), inArray(tasks.id, ids), isNull(tasks.deletedAt)];
      // Assigned-only editors can only touch their own tasks.
      if (!canEditAll) {
        conds.push(or(eq(tasks.assigneeId, session.userId), eq(tasks.createdById, session.userId))!);
      }

      // Bulk delete — soft-delete to Trash (recoverable), matching the single
      // delete. Permanent removal happens from the Trash bin.
      if (action === "delete") {
        const removed = await tx
          .update(tasks)
          .set({ deletedAt: new Date(), deletedBy: session.userId, updatedAt: new Date() } as any)
          .where(and(...conds))
          .returning({ id: tasks.id });
        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "task.bulk_delete",
          entityType: "task",
          entityId: session.tenantId,
          after: { count: removed.length, ids } as any,
          ...meta,
        });
        return removed.length;
      }

      // Recurring chain-on-completion: capture the in-scope recurring tasks that
      // are about to transition INTO completed (before the update erases their
      // prior status) so we can spawn each next occurrence — matching the
      // single-task PATCH. Without this, bulk-completing a recurring task
      // silently ended the series.
      const toChain =
        action === "status" && patch.status === "completed"
          ? await tx
              .select()
              .from(tasks)
              .where(and(...conds, sql`recurrence is not null`, sql`status <> 'completed'`))
          : [];

      const updated = await tx
        .update(tasks)
        .set(patch as any)
        .where(and(...conds))
        .returning({ id: tasks.id });

      for (const t of toChain) {
        await spawnNextOccurrence(tx, t as any, session.userId, meta);
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: `task.bulk_${action}`,
        entityType: "task",
        entityId: session.tenantId,
        after: { action, value: value ?? null, count: updated.length, ids } as any,
        ...meta,
      });
      return updated.length;
    });

    return NextResponse.json({ ok: true, updated: count });
  } catch (err: any) {
    return handleApiError(err);
  }
}
