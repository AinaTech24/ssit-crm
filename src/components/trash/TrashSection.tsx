"use client";

/**
 * Collapsible per-module section for the Trash bin. Each deleted-items group
 * (Clients, Tasks, …) gets its own expand/shrink dropdown so the bin stays tidy
 * as more modules gain soft-delete.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export function TrashSection({
  title,
  count,
  icon,
  defaultOpen = true,
  children,
}: {
  title: string;
  count: number;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card-surface overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-secondary/30 transition-colors"
      >
        {open ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
        {icon}
        <span className="font-semibold text-sm">{title}</span>
        <span className="chip text-[11px] bg-secondary text-muted-foreground tabular-nums">{count}</span>
      </button>
      {open && <div className="border-t">{children}</div>}
    </div>
  );
}
