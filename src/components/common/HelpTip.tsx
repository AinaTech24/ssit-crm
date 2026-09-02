"use client";

import * as React from "react";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type HelpTipProps = {
  title: string;
  children: React.ReactNode;
  className?: string;
};

/**
 * In-context help affordance — a small circular "?" button that toggles a
 * plain-English popover explaining a jargon-heavy screen. Closes on
 * outside-click and Esc. Popover is right-aligned and width-capped so it never
 * overflows the viewport on mobile.
 */
export function HelpTip({ title, children, className }: HelpTipProps) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span ref={rootRef} className={cn("relative inline-flex", className)}>
      <button
        type="button"
        aria-label="Help"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-grid place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <HelpCircle className="size-4" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={title}
          className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-3 text-sm text-card-foreground shadow-xl"
        >
          <div className="font-semibold">{title}</div>
          <div className="mt-1 text-muted-foreground [&_a]:text-primary [&_a]:underline">
            {children}
          </div>
        </div>
      )}
    </span>
  );
}

/**
 * Inline "Need help?" affordance for placing next to a page title — a muted
 * label plus the HelpTip popover.
 */
export function PageHelp({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <span>Need help?</span>
      <HelpTip title={title}>{children}</HelpTip>
    </span>
  );
}
