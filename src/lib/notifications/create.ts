/**
 * createNotification — direct in-app notification insert for non-workflow code
 * paths (API routes). Workflows use the create_notification action handler; this
 * is the lightweight, synchronous equivalent for things like "task assigned to
 * you" / "task status changed" emitted straight from a route handler.
 *
 * Call inside an existing withTenant() transaction so it's atomic with the
 * action that triggered it. The NotificationBell surfaces it (90s poll, plus a refetch whenever the panel is opened).
 */

import { v4 as uuid } from "uuid";
import { notifications } from "@/db/schema";

export type NotifySeverity = "info" | "success" | "warning" | "critical";

export async function createNotification(
  tx: any,
  n: {
    tenantId: string;
    userId: string; // recipient
    kind: string; // e.g. "task.assigned" | "task.status_changed"
    title: string;
    body?: string | null;
    linkUrl?: string | null;
    severity?: NotifySeverity;
    meta?: Record<string, unknown> | null;
  }
): Promise<void> {
  await tx.insert(notifications).values({
    id: uuid(),
    tenantId: n.tenantId,
    userId: n.userId,
    kind: n.kind,
    title: n.title,
    body: n.body ?? null,
    linkUrl: n.linkUrl ?? null,
    severity: n.severity ?? "info",
    meta: n.meta ?? null,
  } as any);
}
