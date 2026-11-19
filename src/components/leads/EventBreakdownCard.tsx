"use client";

/**
 * "Which events did these leads come from?" - one chip per event with the number of
 * leads, each a filter: click to show only that event, click again to clear it.
 * Several events can be on at once (they are OR-ed), exactly like the Event choice in
 * the filter menu - both write the same `?event=` parameter, so they always agree.
 *
 * Above the chips sits an "All / Event leads / Other leads" switch (?origin=event|other):
 * Event leads are the ones that carry an event name, Other leads everything else.
 *
 * Counts come from the same query as the list (data wall included) but WITHOUT the
 * event filter itself, so picking an event does not hide the others.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays } from "lucide-react";

export type EventRow = { label: string; count: number };

const norm = (s: string) => s.trim().toLowerCase();

export function EventBreakdownCard({
  basePath,
  rows,
  origin = "",
  originCounts,
}: {
  basePath: string;
  rows: EventRow[];
  origin?: "" | "event" | "other";
  originCounts?: { event: number; other: number };
}) {
  const router = useRouter();
  const sp = useSearchParams();
  // Nothing to show only when there are no event leads AND no switch to offer.
  if (rows.length === 0 && !originCounts) return null;

  function setOrigin(next: "" | "event" | "other") {
    const params = new URLSearchParams(sp?.toString() ?? "");
    if (next) params.set("origin", next);
    else params.delete("origin");
    // An event choice means nothing under "Other leads", and "All" starts afresh.
    if (next === "other") params.delete("event");
    params.delete("page");
    const qs = params.toString();
    router.push(`${basePath}${qs ? `?${qs}` : ""}`);
  }

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

  const tabs: Array<{ key: "" | "event" | "other"; label: string; n: number | null }> = [
    { key: "", label: "All leads", n: originCounts ? originCounts.event + originCounts.other : null },
    { key: "event", label: "Event leads", n: originCounts?.event ?? null },
    { key: "other", label: "Other leads", n: originCounts?.other ?? null },
  ];

  return (
    <div className="border rounded-lg bg-card p-3">
      {originCounts && (
        <div className="mb-3 inline-flex rounded-lg border border-border bg-secondary/40 p-0.5" role="tablist" aria-label="Lead origin">
          {tabs.map((t) => (
            <button
              key={t.key || "all"}
              type="button"
              role="tab"
              aria-selected={origin === t.key}
              onClick={() => setOrigin(t.key)}
              className={`rounded-md px-3 py-1 text-xs transition-colors ${
                origin === t.key ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
              {t.n != null && <span className="ml-1.5 tabular-nums">{t.n}</span>}
            </button>
          ))}
        </div>
      )}
      {rows.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          {origin === "other" ? "Showing leads that did not come from an event." : "No event leads yet."}
        </div>
      ) : (
      <>
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
      </>
      )}
    </div>
  );
}
