import { handleApiError } from "@/lib/api/error-handler";
/**
 * Task watchers (followers).
 *
 *   GET    /api/tasks/[id]/watchers            — list + `youWatch`
 *   POST   /api/tasks/[id]/watchers  {userId?} — add (default: self)
 *   DELETE /api/tasks/[id]/watchers?userId=…   — remove (default: self)
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { tasks, taskWatchers, users } from "@/db/schema";
import { createNotification } from "@/lib/notifications/create";

export const dynamic = "force-dynamic";

function ownsTask(t: { assigneeId: string | null; createdById: string | null }, userId: string): boolean {
  return t.assigneeId === userId || t.createdById === userId;
}

async function loadTask(tx: any, tenantId: string, id: string) {
  const [t] = await tx
    .select({ assigneeId: tasks.assigneeId, createdById: tasks.createdById, title: tasks.title })
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantId)))
    .limit(1);
  return t ?? null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.view.all", "task.view.assigned"], session.permissions);
    const canViewAll = can(session.roles, "task.view.all", session.permissions);
    const out = await withTenant(session.tenantId, async (tx) => {
      const t = await loadTask(tx, session.tenantId, id);
      if (!t) return null;
      if (!canViewAll && !ownsTask(t, session.userId)) return null;
      const rows = await tx
        .select({ userId: taskWatchers.userId, name: users.name })
        .from(taskWatchers)
        .leftJoin(users, eq(users.id, taskWatchers.userId))
        .where(and(eq(taskWatchers.taskId, id), eq(taskWatchers.tenantId, session.tenantId)));
      return {
        watchers: rows.map((r: any) => ({ userId: r.userId, name: r.name })),
        youWatch: rows.some((r: any) => r.userId === session.userId),
      };
    });
    if (out === null) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(out);
  } catch (err: any) {
    return handleApiError(err);
  }
}

const PostBody = z.object({ userId: z.string().uuid().optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.view.all", "task.view.assigned"], session.permissions);
    const canViewAll = can(session.roles, "task.view.all", session.permissions);
    const parse = PostBody.safeParse(await req.json().catch(() => ({})));
    const target = parse.success && parse.data.userId ? parse.data.userId : session.userId;

    const outcome = await withTenant(session.tenantId, async (tx) => {
      const t = await loadTask(tx, session.tenantId, id);
      if (!t) return "not_found" as const;
      if (!canViewAll && !ownsTask(t, session.userId)) return "forbidden" as const;
      // Target must be a real user in this tenant.
      const [u] = await tx.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.id, target), eq(users.tenantId, session.tenantId))).limit(1);
      if (!u) return "bad_user" as const;
      await tx.insert(taskWatchers).values({ tenantId: session.tenantId, taskId: id, userId: target }).onConflictDoNothing();
      // Notify the person added (unless they added themselves).
      if (target !== session.userId) {
        await createNotification(tx, {
          tenantId: session.tenantId,
          userId: target,
          kind: "task.watching",
          title: `You're now following: ${t.title}`,
          body: "You'll get this task's updates.",
          linkUrl: "/dashboard/tasks?view=assigned_to_me",
          severity: "info",
          meta: { task_id: id },
        });
      }
      return "ok" as const;
    });
    if (outcome === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    if (outcome === "forbidden") return NextResponse.json({ error: "no access to this task" }, { status: 403 });
    if (outcome === "bad_user") return NextResponse.json({ error: "user not in this firm" }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.view.all", "task.view.assigned"], session.permissions);
    const target = new URL(req.url).searchParams.get("userId") || session.userId;
    await withTenant(session.tenantId, async (tx) => {
      await tx
        .delete(taskWatchers)
        .where(and(eq(taskWatchers.taskId, id), eq(taskWatchers.tenantId, session.tenantId), eq(taskWatchers.userId, target)));
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
