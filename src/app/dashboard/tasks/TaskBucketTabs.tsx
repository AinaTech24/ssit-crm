import Link from "next/link";
import { CircleDot, CheckCircle2, XCircle, Layers } from "lucide-react";
import { TASK_BUCKETS, type TaskBucketKey } from "@/lib/tasks/buckets";

const ICON = { open: CircleDot, completed: CheckCircle2, closed: XCircle, all: Layers } as const;

/** Big Open / Completed / Closed / All buttons above the task list, each with its count. */
export function TaskBucketTabs({
  params,
  active,
  counts,
}: {
  params: Record<string, string | undefined>;
  active: TaskBucketKey | null;
  counts: Record<TaskBucketKey, number>;
}) {
  function href(key: TaskBucketKey) {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      // A button replaces whatever else picked the status, and starts from page 1.
      if (v && !["bucket", "status", "approval", "page", "task"].includes(k)) next.set(k, v);
    }
    if (key !== "open") next.set("bucket", key);
    const qs = next.toString();
    return qs ? `/dashboard/tasks?${qs}` : "/dashboard/tasks";
  }

  return (
    <nav aria-label="Tasks by status" className="flex items-stretch gap-2 flex-wrap">
      {TASK_BUCKETS.map((b) => {
        const Icon = ICON[b.key];
        const on = active === b.key;
        const isOpen = b.key === "open";
        const look = on
          ? "bg-primary text-primary-foreground border-primary shadow-sm"
          : isOpen
            ? "bg-card text-foreground border-primary hover:bg-accent"
            : "bg-card text-muted-foreground border-border hover:text-foreground hover:bg-accent";
        return (
          <Link
            key={b.key}
            href={href(b.key)}
            title={b.hint}
            aria-current={on ? "page" : undefined}
            className={`rounded-lg border-2 flex items-center gap-2 font-semibold transition-colors ${isOpen ? "px-5 py-2.5 text-base" : "px-4 py-2 text-sm"} ${look}`}
          >
            <Icon className={isOpen ? "size-5" : "size-4"} />
            {b.label}
            <span className={`rounded-full px-2 text-xs font-bold tabular-nums ${on ? "bg-primary-foreground text-primary" : "bg-secondary text-foreground"}`}>
              {counts[b.key]}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
