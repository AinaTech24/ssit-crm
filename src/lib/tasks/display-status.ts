/**
 * The status a person SEES on a task.
 *
 * When the assigner approves a marketing creative, the task is not finished — the
 * marketing person still has to post it, so underneath its status stays open /
 * in progress (which is what every "open tasks", "due today" and reminder query
 * counts). What people should see is that it has been approved, so the screens
 * show "Approved" until the creative is marked uploaded (status completed).
 *
 * Display only: nothing here changes what is stored.
 */

export type StatusLike = { status?: string | null; approvalStatus?: string | null };

/** Approved by the assigner, not yet marked uploaded / completed. */
export function isApprovedAwaitingPost(t: StatusLike): boolean {
  return t.approvalStatus === "approved" && (t.status === "open" || t.status === "in_progress");
}

/** "approved" for an approved-and-not-yet-posted task, otherwise the stored status. */
export function displayStatus(t: StatusLike): string {
  return isApprovedAwaitingPost(t) ? "approved" : (t.status ?? "open");
}
