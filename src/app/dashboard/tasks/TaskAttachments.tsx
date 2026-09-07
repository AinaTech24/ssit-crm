"use client";

/**
 * TaskAttachments — upload / list / download / delete files on a task.
 *
 * Thin wrapper over the shared implementation. This used to be its own
 * single-file uploader; it now takes several files at once (and drag-and-drop)
 * from the same component meetings use, so the two cannot drift.
 */

import { EntityAttachments } from "@/components/common/EntityAttachments";

export function TaskAttachments({ taskId }: { taskId: string }) {
  return <EntityAttachments basePath={`/api/tasks/${taskId}/attachments`} />;
}
