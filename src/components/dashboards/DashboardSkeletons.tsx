import React from "react";

export function CardSkeleton() {
  return (
    <div className="card-surface glass-card p-5 animate-pulse min-h-[140px] flex flex-col justify-between">
      <div className="space-y-2">
        <div className="h-3 w-1/3 bg-slate-200 dark:bg-slate-800 rounded" />
        <div className="h-6 w-1/2 bg-slate-300 dark:bg-slate-700 rounded mt-2" />
      </div>
      <div className="h-3 w-2/3 bg-slate-200 dark:bg-slate-800 rounded mt-4" />
    </div>
  );
}

export function ChartSkeleton({ height = "h-56" }: { height?: string }) {
  return (
    <div className="card-surface glass-card p-5 animate-pulse flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <div className="h-4 w-1/4 bg-slate-200 dark:bg-slate-800 rounded" />
        <div className="h-3 w-16 bg-slate-200 dark:bg-slate-800 rounded" />
      </div>
      <div className={`w-full ${height} bg-slate-100 dark:bg-slate-800/50 rounded-lg flex items-end justify-between p-4 gap-2`}>
        <div className="h-1/3 w-full bg-slate-200 dark:bg-slate-700/60 rounded" />
        <div className="h-2/3 w-full bg-slate-200 dark:bg-slate-700/60 rounded" />
        <div className="h-1/2 w-full bg-slate-200 dark:bg-slate-700/60 rounded" />
        <div className="h-3/4 w-full bg-slate-200 dark:bg-slate-700/60 rounded" />
        <div className="h-2/5 w-full bg-slate-200 dark:bg-slate-700/60 rounded" />
        <div className="h-5/6 w-full bg-slate-200 dark:bg-slate-700/60 rounded" />
      </div>
    </div>
  );
}

/** Full-page fallback while a role dashboard streams in (Suspense boundary on
 *  /dashboard) — KPI row + two chart placeholders, matching the cockpit shape. */
export function DashboardPageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <ChartSkeleton />
        <LeaderboardSkeleton />
      </div>
    </div>
  );
}

export function LeaderboardSkeleton() {
  return (
    <div className="card-surface glass-card p-5 animate-pulse flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <div className="h-4 w-1/3 bg-slate-200 dark:bg-slate-800 rounded" />
        <div className="h-3 w-16 bg-slate-200 dark:bg-slate-800 rounded" />
      </div>
      <div className="space-y-3.5 my-1">
        {Array.from({ length: 5 }).map((_, idx) => (
          <div key={idx} className="flex justify-between items-center">
            <div className="h-3 w-1/4 bg-slate-200 dark:bg-slate-800 rounded" />
            <div className="h-3 w-12 bg-slate-200 dark:bg-slate-800 rounded" />
            <div className="h-3 w-20 bg-slate-300 dark:bg-slate-700 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
