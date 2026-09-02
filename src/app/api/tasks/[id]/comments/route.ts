import { handleApiError } from "@/lib/api/error-handler";
/**
 * Threaded comments on a task.
 *
 *   GET  /api/tasks/[id]/comments  — list (author names, oldest first)
 *   POST /api/tasks/[id]/comments  — add a comment; @mentioned users + the
 *                                    task's assignee/creator get notified.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/create";
import { tasks, taskComments, users } from "@/db/schema";
import { notifyWatchers } from "@/lib/tasks/watchers";

export const dynamic = "force-dynamic";

function ownsTask(task: { assigneeId: string | null; createdById: string | null }, userId: string): boolean {
  return task.assigneeId === userId || task.createdById === userId;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.view.all", "task.view.assigned"], session.permissions);
    const canViewAll = can(session.roles, "task.view.all", session.permissions);

    const rows = await withTenant(session.tenantId, async (tx) => {
      const [task] = await tx
        .select({ assigneeId: tasks.assigneeId, createdById: tasks.createdById })
        .from(tasks)
        .where(and(eq(tasks.id, id), eq(tasks.tenantId, session.tenantId)))
        .limit(1);
      if (!task) return null;
      if (!canViewAll && !ownsTask(task, session.userId)) return null;
      return tx
        .select({ c: taskComments, authorName: users.name, authorAvatarUrl: users.avatarUrl })
        .from(taskComments)
        .leftJoin(users, eq(users.id, taskComments.authorId))
        .where(and(eq(taskComments.taskId, id), eq(taskComments.tenantId, session.tenantId), isNull(taskComments.deletedAt)))
        .orderBy(asc(taskComments.createdAt));
    });
    if (rows === null) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({
      comments: rows.map((r) => ({ ...r.c, authorName: r.authorName, authorAvatarUrl: r.authorAvatarUrl })),
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}

const Body = z.object({
  body: z.string().min(1).max(5000),
  /** Mentioned user ids — filtered to real tenant users server-side. */
  mentions: z.array(z.string().uuid()).max(30).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.view.all", "task.view.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const canViewAll = can(session.roles, "task.view.all", session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const clientMeta = clientMetaFromHeaders(req.headers);

    const outcome = await withTenant(session.tenantId, async (tx) => {
      const [task] = await tx
        .select({ title: tasks.title, assigneeId: tasks.assigneeId, createdById: tasks.createdById })
        .from(tasks)
        .where(and(eq(tasks.id, id), eq(tasks.tenantId, session.tenantId)))
        .limit(1);
      if (!task) return "not_found" as const;
      if (!canViewAll && !ownsTask(task, session.userId)) return "not_found" as const;

      // Keep only mention ids that are real users in this tenant.
      let mentions: string[] = [];
      if (parse.data.mentions?.length) {
        const valid = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(inArray(users.id, parse.data.mentions), eq(users.tenantId, session.tenantId)));
        mentions = valid.map((v) => v.id);
      }

      const [inserted] = await tx
        .insert(taskComments)
        .values({ tenantId: session.tenantId, taskId: id, authorId: session.userId, body: parse.data.body, mentions })
        .returning();

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "task.comment",
        entityType: "task",
        entityId: id,
        after: { commentId: inserted.id } as any,
        ...clientMeta,
      });

      const actorName =
        (await tx.select({ name: users.name }).from(users).where(eq(users.id, session.userId)).limit(1))[0]?.name ??
        "A teammate";
      const preview = parse.data.body.length > 90 ? parse.data.body.slice(0, 90) + "…" : parse.data.body;

      // Notify @mentioned users first (highest signal).
      const notified = new Set<string>([session.userId]); // never self-notify
      for (const uid of mentions) {
        if (notified.has(uid)) continue;
        notified.add(uid);
        await createNotification(tx, {
          tenantId: session.tenantId,
          userId: uid,
          kind: "task.mention",
          title: `${actorName} mentioned you: ${task.title}`,
          body: preview,
          linkUrl: "/dashboard/tasks?view=assigned_to_me",
          severity: "info",
          meta: { task_id: id, comment_id: inserted.id },
        });
      }
      // Then the task's assignee + creator (if not already covered / the author).
      for (const uid of [task.assigneeId, task.createdById]) {
        if (!uid || notified.has(uid)) continue;
        notified.add(uid);
        await createNotification(tx, {
          tenantId: session.tenantId,
          userId: uid,
          kind: "task.comment",
          title: `New comment: ${task.title}`,
          body: `${actorName}: ${preview}`,
          linkUrl: "/dashboard/tasks?view=assigned_to_me",
          severity: "info",
          meta: { task_id: id, comment_id: inserted.id },
        });
      }

      // Finally, any watchers not already notified.
      await notifyWatchers(tx, {
        tenantId: session.tenantId,
        taskId: id,
        exclude: notified,
        kind: "task.comment",
        title: `New comment: ${task.title}`,
        body: `${actorName}: ${preview}`,
      });

      return { comment: { ...inserted, authorName: actorName } };
    });

    if (outcome === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(outcome, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
