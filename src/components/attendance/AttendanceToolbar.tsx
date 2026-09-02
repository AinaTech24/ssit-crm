"use client";

/**
 * Attendance table toolbar — a search box + a "Filters" icon-popover, sitting in
 * the table header's right corner. The popover holds the multi-select status,
 * a date range and a "Today only" toggle. All controls drive the same URL query
 * params the page already reads (q, status, date_from/date_to, today), so the
 * server re-renders the filtered rows.
 */

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, SlidersHorizontal, X } from "lucide-react";

export function AttendanceToolbar({ statusOptions }: { statusOptions: { value: string; label: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(sp.get("q") ?? "");
  const ref = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  // Debounced search → q param.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    const id = setTimeout(() => setParam({ q: q.trim() || null }), 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Close popover on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const statusSel = (sp.get("status") ?? "").split(",").filter(Boolean);
  const dateFrom = sp.get("date_from") ?? "";
  const dateTo = sp.get("date_to") ?? "";
  const todayOnly = sp.get("today") === "1";
  const activeCount = statusSel.length + (dateFrom || dateTo ? 1 : 0) + (todayOnly ? 1 : 0);

  function setParam(updates: Record<string, string | null>) {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === "") p.delete(k); else p.set(k, v);
    }
    p.delete("page");
    router.replace(`${pathname}?${p.toString()}`);
  }
  function toggleStatus(v: string) {
    const next = statusSel.includes(v) ? statusSel.filter((x) => x !== v) : [...statusSel, v];
    setParam({ status: next.join(",") || null, today: null });
  }
  function clearAll() {
    setQ("");
    setParam({ q: null, status: null, date_from: null, date_to: null, today: null });
  }

  return (
    <div className="flex items-center gap-2 shrink-0">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search employee…"
          className="w-36 sm:w-56 rounded-lg border border-border bg-background pl-8 pr-7 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-cyan/20 focus:border-brand-cyan/50"
        />
        {q && (
          <button type="button" onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search">
            <X className="size-3.5" />
          </button>
        )}
      </div>

      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label="Filters"
          className={`relative inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
            activeCount ? "border-brand-cyan/50 bg-brand-cyan-light/40 text-brand-cyan-deep" : "border-border text-muted-foreground hover:bg-secondary"
          }`}
        >
          <SlidersHorizontal className="size-3.5" />
          <span className="hidden sm:inline">Filters</span>
          {activeCount > 0 && (
            <span className="grid place-items-center min-w-4 h-4 px-1 rounded-full bg-brand-cyan text-white text-[10px] font-bold leading-none">{activeCount}</span>
          )}
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-1.5 z-30 w-64 rounded-xl border border-border bg-card shadow-lg p-3 space-y-3">
            <div>
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Status</div>
              <div className="flex flex-wrap gap-1.5">
                {statusOptions.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => toggleStatus(o.value)}
                    className={`text-[11px] px-2 py-1 rounded-md border transition ${
                      statusSel.includes(o.value) ? "border-brand-cyan bg-brand-cyan-light/50 text-brand-cyan-deep font-medium" : "border-border text-muted-foreground hover:bg-secondary"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Date range</div>
              <div className="flex items-center gap-1.5">
                <input type="date" value={dateFrom} onChange={(e) => setParam({ date_from: e.target.value || null, today: null })} className="input-base h-8 text-xs flex-1 min-w-0" aria-label="From date" />
                <span className="text-muted-foreground text-xs">–</span>
                <input type="date" value={dateTo} onChange={(e) => setParam({ date_to: e.target.value || null, today: null })} className="input-base h-8 text-xs flex-1 min-w-0" aria-label="To date" />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={todayOnly} onChange={(e) => setParam({ today: e.target.checked ? "1" : null, date_from: null, date_to: null })} className="size-3.5 accent-brand-cyan" />
              Today only
            </label>

            <div className="flex items-center justify-between pt-2 border-t border-border">
              <button type="button" onClick={clearAll} className="text-[11px] text-muted-foreground hover:text-foreground">Clear all</button>
              <button type="button" onClick={() => setOpen(false)} className="text-[11px] font-medium text-brand-cyan-deep">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
