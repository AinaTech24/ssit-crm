"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export function CollapsibleCards({
  label = "Key metrics",
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown
          className={`size-4 transition-transform ${open ? "" : "-rotate-90"}`}
        />
        {label}
      </button>

      {open && <div className="mt-3 space-y-3">{children}</div>}
    </div>
  );
}
