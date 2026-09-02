import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single-task endpoints.
 *
 *   GET    /api/tasks/[id]   — fetch one task
 *   PATCH  /api/tasks/[id]   — update status, priority, due, assignee
 *   DELETE /api/tasks/[id]   — soft cancel (status='cancelled')
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/create";
import { spawnNextOccurrence } from "@/lib/tasks/recurrence";
import { notifyWatchers } from "@/lib/tasks/watchers";
import { tasks, users, taskChecklist } from "@/db/schema";

export const dynamic = "force-dynamic";

/** A view.assigned/edit.assigned user may only touch tasks they own. */
function ownsTask(task: { assigneeId: string | null; createdById: string | null }, userId: string): boolean {
  return task.assigneeId === userId || task.createdById === userId;
}

/** True if the user is delegated any sub-task on this task — grants them read +
 *  edit access to the parent task (so they can see it and update their step). */
function isSubtaskAssignee(task: { meta: unknown }, userId: string): boolean {
  return taskChecklist(task.meta).some((c) => c.assigneeId === userId);
}

const Patch = z.object({
  title: z.string().min(2).max(200).optional(),
  description: z.string().optional(),
  status: z.enum(["open", "in_progress", "blocked", "completed", "cancelled"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  assigneeId: z.string().uuid().optional(),
  dueAt: z.string().optional(),
  slaDueAt: z.string().nullable().optional(),
  // Module 18 — explicit related entity + department + remarks
  relatedInvestorId: z.string().uuid().optional(),
  relatedLeadId: z.string().uuid().optional(),
  relatedServiceRequestId: z.string().uuid().optional(),
  relatedMeetingId: z.string().uuid().optional(),
  department: z
    .enum([
      "sales",
      "operations",
      "back_office",
      "compliance",
      "marketing",
      "advisory",
      "support",
      "leadership",
      "other",
    ])
    .optional(),
  remarks: z.string().max(20000).optional(),
  /** Approval loop. `requiresApproval` toggles the loop on/off (creator/owner).
   *  `approvalAction` drives the lifecycle: assignee `submit`s → approver
   *  `approve`s (→ completed) or `reject`s (→ reopened) with an optional note. */
  requiresApproval: z.boolean().optional(),
  approvalAction: z.enum(["submit", "approve", "reject"]).optional(),
  approvalNote: z.string().max(2000).optional(),
  /** Per-task reminder — absolute ISO time (null clears it). Editing it re-arms. */
  remindAt: z.string().nullable().optional(),
  /** Planned effort in minutes (time tracking). */
  estimateMinutes: z.number().int().min(0).max(100000).nullable().optional(),
  /** Free-form tags. */
  tags: z.array(z.string().min(1).max(40)).max(30).optional(),
  /** Dependency — task that blocks this one (null clears it). */
  blockedByTaskId: z.string().uuid().nullable().optional(),
  /** Action points (checklist). Stored under meta.checklist — no schema column.
   *  Every per-item field is validated so none are silently stripped on save
   *  (status / remark / actionDate + the delegate assignee). */
  checklist: z
    .array(
      z.object({
        id: z.string().max(64),
        text: z.string().min(1).max(500),
        done: z.boolean(),
        doneAt: z.string().nullable().optional(),
        status: z.enum(["not_started", "in_progress", "completed", "assigned_to_other"]).optional(),
        actionDate: z.string().nullable().optional(),
        remark: z.string().max(2000).optional(),
        /** Delegate this sub-task to a team member (tenant user id). */
        assigneeId: z.string().uuid().nullable().optional(),
        assigneeName: z.string().max(200).nullable().optional(),
      })
    )
    .max(100)
    .optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.view.all", "task.view.assigned"], session.permissions);
    const canViewAll = can(session.roles, "task.view.all", session.permissions);
    const row = await withTenant(session.tenantId, async (tx) =>
      (await tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, id), eq(tasks.tenantId, session.tenantId)))
        .limit(1))[0] ?? null
    );
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    // Assigned-only viewers can't read other people's tasks — unless a sub-task
    // is delegated to them (then they may open + update the parent task).
    if (!canViewAll && !ownsTask(row, session.userId) && !isSubtaskAssignee(row, session.userId)) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json(row);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.edit.all", "task.edit.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const clientMeta = clientMetaFromHeaders(req.headers);
    const canEditAll = can(session.roles, "task.edit.all", session.permissions);

    // checklist + approval verbs live outside the column patch — pull them out.
    // checklist is merged into meta inside the tx; the approval verbs drive the
    // lifecycle branch below.
    const { checklist, approvalAction, approvalNote, ...rest } = parse.data;
    const patch: any = { ...rest, updatedAt: new Date() };
    if (parse.data.status === "completed" && !patch.completedAt) patch.completedAt = new Date();
    // Drizzle timestamp columns require Date objects — coerce the ISO strings
    // the client sends (passing a raw string makes Drizzle call .toISOString()
    // on it and throw a 500). An invalid/null string clears the value.
    for (const k of ["dueAt", "slaDueAt", "remindAt"] as const) {
      const v = patch[k];
      if (v === null) continue; // explicit clear (slaDueAt/remindAt are nullable)
      if (typeof v === "string") {
        const d = new Date(v);
        if (isNaN(d.getTime())) {
          if (k === "slaDueAt" || k === "remindAt") patch[k] = null;
          else delete patch[k];
        } else {
          patch[k] = d;
        }
      }
    }
    // Editing the reminder re-arms it (clears the fired watermark so it fires again).
    if ("remindAt" in rest) patch.reminderFiredAt = null;

    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, id), eq(tasks.tenantId, session.tenantId)))
        .limit(1))[0];
      if (!before) return null;
      // Assigned-only editors may only touch their own tasks — or a task where a
      // sub-task is delegated to them (so a delegate can update their step).
      if (!canEditAll && !ownsTask(before, session.userId) && !isSubtaskAssignee(before, session.userId)) {
        return { forbidden: true as const };
      }
      // Merge the action-point checklist into meta (read-modify-write inside the
      // tx so we keep any other meta keys the task already carries).
      if (checklist !== undefined) {
        patch.meta = { ...((before.meta as Record<string, unknown>) ?? {}), checklist };
      }
      // A reassignment target must be a user in this tenant.
      if (parse.data.assigneeId !== undefined) {
        const [u] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, parse.data.assigneeId), eq(users.tenantId, session.tenantId)))
          .limit(1);
        if (!u) return { badAssignee: true as const };
      }

      // Actor name — used by both the approval and the generic notifications.
      const actorName =
        (await tx.select({ name: users.name }).from(users).where(eq(users.id, session.userId)).limit(1))[0]?.name ??
        "A teammate";

      // ── Approval / verification loop ──────────────────────────────────
      // The approver is the task's creator or any view-all user (owner). We
      // queue exactly one approval notification and let the generic status
      // notification below stand down (`approvalHandled`).
      const isApprover = canEditAll || before.createdById === session.userId;
      let approvalNotif:
        | null
        | { userId: string; kind: string; title: string; body: string; severity: any; linkUrl: string } = null;
      // Assignee marking a requires-approval task "completed" is re-routed to a
      // submit-for-approval (can't self-complete past the gate).
      const assigneeTriedToComplete =
        patch.status === "completed" && before.requiresApproval && before.approvalStatus !== "approved" && !isApprover;
      const approvalHandled = !!approvalAction || assigneeTriedToComplete;

      if (approvalAction === "submit" || assigneeTriedToComplete) {
        delete patch.status;
        delete patch.completedAt;
        patch.approvalStatus = "pending";
        patch.submittedAt = new Date();
        if (before.createdById && before.createdById !== session.userId) {
          approvalNotif = {
            userId: before.createdById,
            kind: "task.approval_requested",
            title: `Approval needed: ${before.title}`,
            body: `${actorName} submitted this task for your approval`,
            severity: "info",
            linkUrl: "/dashboard/tasks?approval=mine",
          };
        }
      } else if (approvalAction === "approve") {
        if (!isApprover) return { forbidden: true as const };
        patch.approvalStatus = "approved";
        patch.approvedBy = session.userId;
        patch.approvedAt = new Date();
        patch.status = "completed";
        patch.completedAt = new Date();
        if (approvalNote) patch.approvalNote = approvalNote;
        if (before.assigneeId && before.assigneeId !== session.userId) {
          approvalNotif = {
            userId: before.assigneeId,
            kind: "task.approved",
            title: `Approved: ${before.title}`,
            body: `${actorName} approved your completed task`,
            severity: "success",
            linkUrl: "/dashboard/tasks?view=assigned_to_me",
          };
        }
      } else if (approvalAction === "reject") {
        if (!isApprover) return { forbidden: true as const };
        patch.approvalStatus = "rejected";
        patch.approvedBy = session.userId;
        patch.approvedAt = new Date();
        patch.approvalNote = approvalNote ?? null;
        patch.status = "in_progress";
        if (before.assigneeId && before.assigneeId !== session.userId) {
          approvalNotif = {
            userId: before.assigneeId,
            kind: "task.rejected",
            title: `Reopened: ${before.title}`,
            body: approvalNote ? `${actorName} reopened your task: ${approvalNote}` : `${actorName} reopened your task for changes`,
            severity: "warning",
            linkUrl: "/dashboard/tasks?view=assigned_to_me",
          };
        }
      }

      const after = await tx
        .update(tasks)
        .set(patch)
        .where(and(eq(tasks.id, id), eq(tasks.tenantId, session.tenantId)))
        .returning();

      if (approvalNotif) {
        await createNotification(tx, { tenantId: session.tenantId, ...approvalNotif, meta: { task_id: id } });
      }
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "task.update",
        entityType: "task",
        entityId: id,
        before: { status: before.status, assigneeId: before.assigneeId } as any,
        after: parse.data as any,
        ...clientMeta,
      });

      // ── Notifications ─────────────────────────────────────────────────
      // (actorName already resolved above.) The generic status-change ping to
      // the creator stands down when an approval action already notified the
      // right party (`approvalHandled`) to avoid a confusing double alert.
      const willReassign =
        parse.data.assigneeId !== undefined &&
        parse.data.assigneeId !== before.assigneeId &&
        parse.data.assigneeId !== session.userId;
      const willNotifyCreator =
        !approvalHandled &&
        parse.data.status !== undefined &&
        parse.data.status !== before.status &&
        !!before.createdById &&
        before.createdById !== session.userId;
      if (willReassign || willNotifyCreator) {
        // (1) Reassigned → notify the NEW assignee.
        if (willReassign) {
          await createNotification(tx, {
            tenantId: session.tenantId,
            userId: parse.data.assigneeId!,
            kind: "task.assigned",
            title: `Task assigned: ${before.title}`,
            body: `${actorName} assigned this task to you`,
            linkUrl: "/dashboard/tasks?view=assigned_to_me",
            severity: "info",
            meta: { task_id: id, assigned_by: session.userId, from_assignee: before.assigneeId },
          });
        }

        // (2) Status changed by someone other than the creator → notify the creator.
        if (willNotifyCreator) {
          const human = (s: string) => s.replace(/_/g, " ");
          await createNotification(tx, {
            tenantId: session.tenantId,
            userId: before.createdById!,
            kind: "task.status_changed",
            title: `Task ${human(parse.data.status!)}: ${before.title}`,
            body: `${actorName} moved it from “${human(before.status)}” to “${human(parse.data.status!)}”`,
            linkUrl: "/dashboard/tasks?view=assigned_by_me",
            severity: parse.data.status === "completed" ? "success" : parse.data.status === "blocked" ? "warning" : "info",
            meta: { task_id: id, changed_by: session.userId, from_status: before.status, to_status: parse.data.status },
          });
        }
      }

      // (2b) Watchers (followers) → notify on a status change, skipping anyone
      //      already covered above (actor / creator / assignee).
      if (!approvalHandled && parse.data.status !== undefined && parse.data.status !== before.status) {
        const human = (s: string) => s.replace(/_/g, " ");
        await notifyWatchers(tx, {
          tenantId: session.tenantId,
          taskId: id,
          exclude: new Set([session.userId, before.createdById ?? "", before.assigneeId ?? ""]),
          kind: "task.status_changed",
          title: `Task ${human(parse.data.status!)}: ${before.title}`,
          body: `${actorName} moved it to “${human(parse.data.status!)}”`,
          severity: parse.data.status === "completed" ? "success" : "info",
        });
      }

      // (3) Sub-task delegated to a teammate → notify each NEWLY-assigned
      //     delegate (they can now open + edit this task). Only real members of
      //     this tenant are notified; re-saving an unchanged assignee is silent.
      if (checklist !== undefined) {
        const prevAssignee = new Map(taskChecklist(before.meta).map((c) => [c.id, c.assigneeId ?? null]));
        const newlyAssigned = new Set<string>();
        for (const c of checklist) {
          const a = c.assigneeId ?? null;
          if (a && a !== session.userId && a !== prevAssignee.get(c.id)) newlyAssigned.add(a);
        }
        if (newlyAssigned.size > 0) {
          const members = await tx
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.tenantId, session.tenantId), inArray(users.id, [...newlyAssigned])));
          for (const m of members) {
            await createNotification(tx, {
              tenantId: session.tenantId,
              userId: m.id,
              kind: "task.subtask_assigned",
              title: `Sub-task assigned: ${before.title}`,
              body: `${actorName} delegated a sub-task on “${before.title}” to you`,
              linkUrl: `/dashboard/tasks?focus=${id}`,
              severity: "info",
              meta: { task_id: id, assigned_by: session.userId },
            });
          }
        }
      }

      // ── Recurring tasks: chain-on-completion ──────────────────────────
      // Spawn the next occurrence when this update makes the task completed for
      // the first time — covers both a direct complete and an approval sign-off
      // (which sets patch.status='completed'). A submit-for-approval does not
      // complete the task, so it correctly does not spawn.
      const finalStatus = patch.status ?? before.status;
      const spawnedId =
        finalStatus === "completed" && before.status !== "completed"
          ? await spawnNextOccurrence(tx, before, session.userId, clientMeta)
          : null;

      return { ...after[0], spawnedNextId: spawnedId } as any;
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    if ("forbidden" in result) return NextResponse.json({ error: "you can only edit tasks assigned to you" }, { status: 403 });
    if ("badAssignee" in result) return NextResponse.json({ error: "assignee not found in this firm" }, { status: 400 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.edit.all", "task.edit.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const canEditAll = can(session.roles, "task.edit.all", session.permissions);
    const clientMeta = clientMetaFromHeaders(req.headers);
    // `?permanent=1` removes the row entirely (only from the Trash bin). The
    // default soft-deletes the task to Trash (deleted_at) — recoverable until
    // permanently removed. (Cancelling a task is a separate status change.)
    const permanent = req.nextUrl.searchParams.get("permanent") === "1";
    const outcome = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, id), eq(tasks.tenantId, session.tenantId)))
        .limit(1))[0];
      if (!before) return "not_found" as const;
      if (!canEditAll && !ownsTask(before, session.userId)) return "forbidden" as const;
      if (permanent) {
        await tx.delete(tasks).where(and(eq(tasks.id, id), eq(tasks.tenantId, session.tenantId)));
      } else {
        await tx
          .update(tasks)
          .set({ deletedAt: new Date(), deletedBy: session.userId, updatedAt: new Date() } as any)
          .where(and(eq(tasks.id, id), eq(tasks.tenantId, session.tenantId)));
      }
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: permanent ? "task.purge" : "task.delete",
        entityType: "task",
        entityId: id,
        ...clientMeta,
      });
      return "ok" as const;
    });
    if (outcome === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    if (outcome === "forbidden")
      return NextResponse.json({ error: `you can only ${permanent ? "delete" : "cancel"} tasks assigned to you` }, { status: 403 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
