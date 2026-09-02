import { handleApiError } from "@/lib/api/error-handler";
/**
 * Task time tracking.
 *
 *   GET  /api/tasks/[id]/time  — logs + summary { estimateMinutes, spentMinutes,
 *                                runningSince }
 *   POST /api/tasks/[id]/time  — { action: 'start' | 'stop' | 'log', minutes?, note? }
 *       start : begins a timer (sets tasks.started_at = now)
 *       stop  : ends the running timer → writes a time log for the elapsed span
 *       log   : records a manual entry of `minutes`
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { tasks, taskTimeLogs, users } from "@/db/schema";

export const dynamic = "force-dynamic";

function ownsTask(t: { assigneeId: string | null; createdById: string | null }, userId: string): boolean {
  return t.assigneeId === userId || t.createdById === userId;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.view.all", "task.view.assigned"], session.permissions);
    const canViewAll = can(session.roles, "task.view.all", session.permissions);

    const out = await withTenant(session.tenantId, async (tx) => {
      const [t] = await tx
        .select({
          assigneeId: tasks.assigneeId,
          createdById: tasks.createdById,
          estimateMinutes: tasks.estimateMinutes,
          timeSpentMinutes: tasks.timeSpentMinutes,
          startedAt: tasks.startedAt,
        })
        .from(tasks)
        .where(and(eq(tasks.id, id), eq(tasks.tenantId, session.tenantId)))
        .limit(1);
      if (!t) return null;
      if (!canViewAll && !ownsTask(t, session.userId)) return null;
      const logs = await tx
        .select({ l: taskTimeLogs, userName: users.name })
        .from(taskTimeLogs)
        .leftJoin(users, eq(users.id, taskTimeLogs.userId))
        .where(and(eq(taskTimeLogs.taskId, id), eq(taskTimeLogs.tenantId, session.tenantId)))
        .orderBy(desc(taskTimeLogs.loggedAt));
      return {
        estimateMinutes: t.estimateMinutes,
        spentMinutes: t.timeSpentMinutes ?? 0,
        runningSince: t.startedAt,
        logs: logs.map((r) => ({ ...r.l, userName: r.userName })),
      };
    });
    if (out === null) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(out);
  } catch (err: any) {
    return handleApiError(err);
  }
}

const Body = z.object({
  action: z.enum(["start", "stop", "log"]),
  minutes: z.number().int().min(1).max(100000).optional(),
  note: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.edit.all", "task.edit.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const canEditAll = can(session.roles, "task.edit.all", session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const { action, minutes, note } = parse.data;
    if (action === "log" && !minutes) return NextResponse.json({ error: "minutes required" }, { status: 400 });

    const outcome = await withTenant(session.tenantId, async (tx) => {
      const [t] = await tx
        .select({ assigneeId: tasks.assigneeId, createdById: tasks.createdById, startedAt: tasks.startedAt, timeSpentMinutes: tasks.timeSpentMinutes })
        .from(tasks)
        .where(and(eq(tasks.id, id), eq(tasks.tenantId, session.tenantId)))
        .limit(1);
      if (!t) return "not_found" as const;
      if (!canEditAll && !ownsTask(t, session.userId)) return "forbidden" as const;

      if (action === "start") {
        if (t.startedAt) return { running: t.startedAt } as const; // already running — no-op
        await tx.update(tasks).set({ startedAt: new Date(), updatedAt: new Date() } as any).where(eq(tasks.id, id));
        return { running: new Date() } as const;
      }

      if (action === "stop") {
        if (!t.startedAt) return { spent: t.timeSpentMinutes ?? 0 } as const; // nothing running
        const elapsedMin = Math.max(1, Math.round((Date.now() - new Date(t.startedAt).getTime()) / 60000));
        await tx.insert(taskTimeLogs).values({ tenantId: session.tenantId, taskId: id, userId: session.userId, minutes: elapsedMin, note: note ?? null });
        const spent = (t.timeSpentMinutes ?? 0) + elapsedMin;
        await tx.update(tasks).set({ startedAt: null, timeSpentMinutes: spent, updatedAt: new Date() } as any).where(eq(tasks.id, id));
        return { spent, added: elapsedMin } as const;
      }

      // manual log
      await tx.insert(taskTimeLogs).values({ tenantId: session.tenantId, taskId: id, userId: session.userId, minutes: minutes!, note: note ?? null });
      const spent = (t.timeSpentMinutes ?? 0) + minutes!;
      await tx.update(tasks).set({ timeSpentMinutes: spent, updatedAt: new Date() } as any).where(eq(tasks.id, id));
      return { spent, added: minutes } as const;
    });

    if (outcome === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    if (outcome === "forbidden") return NextResponse.json({ error: "you can only track time on your own tasks" }, { status: 403 });
    return NextResponse.json({ ok: true, ...outcome });
  } catch (err: any) {
    return handleApiError(err);
  }
}
