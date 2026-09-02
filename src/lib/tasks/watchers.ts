import { and, eq } from "drizzle-orm";
import { taskWatchers } from "@/db/schema";
import { createNotification, type NotifySeverity } from "@/lib/notifications/create";

/** The user ids watching a task (followers). */
export async function getWatcherIds(tx: any, tenantId: string, taskId: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: taskWatchers.userId })
    .from(taskWatchers)
    .where(and(eq(taskWatchers.tenantId, tenantId), eq(taskWatchers.taskId, taskId)));
  return rows.map((r: any) => r.userId);
}

/**
 * Notify a task's watchers, skipping anyone in `exclude` (e.g. the actor and
 * already-notified assignee/creator/mentions). Safe to call inside the same tx.
 */
export async function notifyWatchers(
  tx: any,
  opts: {
    tenantId: string;
    taskId: string;
    exclude: Set<string>;
    kind: string;
    title: string;
    body?: string | null;
    linkUrl?: string | null;
    severity?: NotifySeverity;
  }
): Promise<void> {
  const watchers = await getWatcherIds(tx, opts.tenantId, opts.taskId);
  for (const uid of watchers) {
    if (opts.exclude.has(uid)) continue;
    opts.exclude.add(uid);
    await createNotification(tx, {
      tenantId: opts.tenantId,
      userId: uid,
      kind: opts.kind,
      title: opts.title,
      body: opts.body ?? null,
      linkUrl: opts.linkUrl ?? "/dashboard/tasks?view=assigned_to_me",
      severity: opts.severity ?? "info",
      meta: { task_id: opts.taskId, watcher: true },
    });
  }
}
