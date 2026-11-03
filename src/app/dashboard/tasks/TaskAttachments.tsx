"use client";

/**
 * TaskAttachments — upload / list / download / delete files on a task.
 *
 * Thin wrapper over the shared implementation. This used to be its own
 * single-file uploader; it now takes several files at once (and drag-and-drop)
 * from the same component meetings use, so the two cannot drift.
 */

import { EntityAttachments, MAX_MARKETING_ATTACHMENT_BYTES } from "@/components/common/EntityAttachments";

/** `marketing`: creatives (video, reel) get the larger 100 MB ceiling. */
export function TaskAttachments({ taskId, marketing }: { taskId: string; marketing?: boolean }) {
  return (
    <EntityAttachments
      basePath={`/api/tasks/${taskId}/attachments`}
      maxBytes={marketing ? MAX_MARKETING_ATTACHMENT_BYTES : undefined}
    />
  );
}
