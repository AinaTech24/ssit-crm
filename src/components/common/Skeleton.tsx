/**
 * Skeleton primitives — shimmer placeholders shown while a route's server
 * component fetches data. They reuse the `.skeleton` utility (animated gradient)
 * defined in globals.css so the look is consistent everywhere.
 *
 * `PageSkeleton` approximates a typical dashboard page (title + KPI strip +
 * table), so the transition from loading → content doesn't jump.
 */

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

/** A KPI/stat card placeholder. */
export function CardSkeleton() {
  return (
    <div className="border rounded-lg bg-card p-4 space-y-3">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-7 w-28" />
      <Skeleton className="h-3 w-16" />
    </div>
  );
}

/** A list/table placeholder with `rows` shimmer lines. */
export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="border rounded-lg bg-card divide-y divide-border/60">
      <div className="p-3 flex items-center gap-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-24 ml-auto" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="p-3 flex items-center gap-4">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** Full-page skeleton: header + 4 KPI cards + a table. Default loading view. */
export function PageSkeleton() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
      <TableSkeleton />
    </div>
  );
}
