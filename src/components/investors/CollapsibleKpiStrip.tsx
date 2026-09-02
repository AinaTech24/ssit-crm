"use client";

/**
 * Collapsible wrapper around the (server-rendered) Investors KPI strip. Adds a
 * toggle that smoothly expands/shrinks the tiles (grid-rows trick) and remembers
 * the last open/closed choice per browser in localStorage — so a firm that keeps
 * it collapsed stays collapsed on the next visit.
 */

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

export function CollapsibleKpiStrip({
  storageKey = "investors-kpi-open",
  title = "Book snapshot",
  children,
}: {
  storageKey?: string;
  title?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);

  // Restore last choice after hydration (localStorage isn't available on the
  // server, so SSR always renders expanded, then this reconciles).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved != null) setOpen(saved === "1");
    } catch {}
  }, [storageKey]);

  function toggle() {
    setOpen((o) => {
      const next = !o;
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {}
      return next;
    });
  }

  return (
    <div className="space-y-2.5">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown className={`size-4 transition-transform duration-300 ${open ? "" : "-rotate-90"}`} />
        {title}
      </button>
      <div className={`grid transition-all duration-300 ease-in-out ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
        <div className="overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
