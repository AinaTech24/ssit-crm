/**
 * The Open / Completed / Closed buttons on the task list. One definition for the list, its counts and
 * "select all", so the three can't disagree about which tasks a button holds.
 */

export type TaskStatusValue = "open" | "in_progress" | "blocked" | "completed" | "cancelled";
export type TaskBucketKey = "open" | "completed" | "closed" | "all";

export const TASK_BUCKETS: ReadonlyArray<{ key: TaskBucketKey; label: string; hint: string; statuses: TaskStatusValue[] | null }> = [
  { key: "open", label: "Open", hint: "Still to be done: open, in progress or blocked", statuses: ["open", "in_progress", "blocked"] },
  { key: "completed", label: "Completed", hint: "Done", statuses: ["completed"] },
  { key: "closed", label: "Closed", hint: "Cancelled without being done", statuses: ["cancelled"] },
  { key: "all", label: "All", hint: "Every status", statuses: null },
];

/** No (or an unknown) choice means Open. */
export function parseBucket(value: string | null | undefined): TaskBucketKey {
  return TASK_BUCKETS.find((b) => b.key === value)?.key ?? "open";
}

export function bucketStatuses(key: TaskBucketKey): TaskStatusValue[] | null {
  return TASK_BUCKETS.find((b) => b.key === key)?.statuses ?? null;
}

/**
 * Which button to light up. A Status filter or an approval view overrides the buttons: then light the
 * one that contains everything the filter asks for, or none.
 */
export function activeBucket(value: string | null | undefined, statusFilter: string[], approval: string): TaskBucketKey | null {
  if (statusFilter.length) {
    return TASK_BUCKETS.find((b) => b.statuses && statusFilter.every((s) => (b.statuses as string[]).includes(s)))?.key ?? null;
  }
  return approval ? null : parseBucket(value);
}
