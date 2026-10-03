/**
 * The row of headline counts at the top of a list module — "Total / today /
 * done / problem" — in the same shape the Leads page has always had, so every
 * module reads the same way.
 *
 * Counts are computed by the page under the caller's data wall but NOT under the
 * list's own search / status filters: "total tasks" has to mean the book, not
 * whatever the table is currently narrowed to.
 */

import type { LucideIcon } from "lucide-react";

export type Kpi = {
  label: string;
  value: number;
  icon: LucideIcon;
  tone?: "emerald" | "rose" | "amber";
};

export function ModuleKpis({ items }: { items: Kpi[] }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {items.map((k) => {
        const Icon = k.icon;
        const tone =
          k.tone === "emerald"
            ? "text-emerald-600 dark:text-emerald-400"
            : k.tone === "rose"
              ? "text-rose-600 dark:text-rose-400"
              : k.tone === "amber"
                ? "text-amber-600 dark:text-amber-400"
                : "text-foreground";
        return (
          <div key={k.label} className="card-surface p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{k.label}</span>
              <Icon className="size-3.5" />
            </div>
            <div className={`text-xl font-bold mt-1 tabular-nums ${tone}`}>{k.value}</div>
          </div>
        );
      })}
    </div>
  );
}
