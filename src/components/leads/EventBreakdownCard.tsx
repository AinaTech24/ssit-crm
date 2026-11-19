"use client";

/**
 * "Which events did these leads come from?" - one chip per event with the number of
 * leads, each a filter: click to show only that event, click again to clear it.
 * Several events can be on at once (they are OR-ed), exactly like the Event choice in
 * the filter menu - both write the same `?event=` parameter, so they always agree.
 *
 * Counts come from the same query as the list (data wall included) but WITHOUT the
 * event filter itself, so picking an event does not hide the others.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays } from "lucide-react";

export type EventRow = { label: string; count: number };

const norm = (s: string) => s.trim().toLowerCase();

export function EventBreakdownCard({ basePath, rows }: { basePath: string; rows: EventRow[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  if (rows.length === 0) return null;

  const active = (sp?.get("event") ?? "").split(",").filter(Boolean).map(norm);

  function toggle(label: string) {
    const params = new URLSearchParams(sp?.toString() ?? "");
    const current = (params.get("event") ?? "").split(",").filter(Boolean);
    const key = norm(label);
    const next = current.some((c) => norm(c) === key) ? current.filter((c) => norm(c) !== key) : [...current, label];
    if (next.length) params.set("event", next.join(","));
    else params.delete("event");
    params.delete("page");
    const qs = params.toString();
    router.push(`${basePath}${qs ? `?${qs}` : ""}`);
  }

  function clearAll() {
    const params = new URLSearchParams(sp?.toString() ?? "");
    params.delete("event");
    params.delete("page");
    const qs = params.toString();
    router.push(`${basePath}${qs ? `?${qs}` : ""}`);
  }

  return (
    <div className="border rounded-lg bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
        <CalendarDays className="size-3.5" /> By event
        {active.length > 0 && (
          <button type="button" onClick={clearAll} className="ml-auto text-[11px] text-brand-cyan hover:underline">
            Clear event filter
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {rows.map((r) => {
          const on = active.includes(norm(r.label));
          return (
            <button
              key={r.label}
              type="button"
              onClick={() => toggle(r.label)}
              title={on ? "Clear this filter" : `Show only leads from ${r.label}`}
              className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent transition-colors ${
                on ? "border-brand-cyan bg-brand-cyan/10 text-brand-cyan font-medium" : "border-border bg-secondary/30"
              }`}
            >
              <span className="truncate max-w-[16rem]">{r.label}</span>
              <span className="tabular-nums font-semibold">{r.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
