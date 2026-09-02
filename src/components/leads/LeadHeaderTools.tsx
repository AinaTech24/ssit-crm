"use client";

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, ArrowRight, Sparkles } from "lucide-react";

/**
 * OverflowMenu — a "More" dropdown that holds secondary record actions
 * (change-log, automations, enroll…) so the primary action bar stays clean.
 * Children are rendered server-side and passed through; clicking inside closes
 * the menu (so an item that opens a modal doesn't leave the menu hanging open).
 */
export function OverflowMenu({ children, label = "More" }: { children: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn-secondary text-sm inline-flex items-center gap-1.5"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal className="size-4" /> {label}
      </button>
      {/* The panel is always mounted and hidden with CSS when closed.
          Unmounting it tore down whichever child had just been clicked —
          every item here opens its own drawer or popover, and they were
          being destroyed in the same tick they opened. For the same reason
          there is no click-to-close: closing is outside-click / Escape, and
          the drawers portal to <body> so they survive it. */}
      <div
        className={`absolute right-0 z-30 mt-1 min-w-[12rem] rounded-lg border bg-popover p-1.5 shadow-lg flex-col gap-1 [&_button]:w-full [&_a]:w-full [&_button]:justify-start [&_a]:justify-start ${
          open ? "flex" : "hidden"
        }`}
        role="menu"
        aria-hidden={!open}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * NextStepBanner — surfaces the blueprint's recommended next action at the top
 * of the lead, so an RM sees "what to do now" without scrolling. The button
 * scrolls to the blueprint section where the real action lives.
 */
export function NextStepBanner({ label, hint }: { label: string; hint?: string | null }) {
  const goToBlueprint = () => {
    const el = document.querySelector("[data-blueprint-section]");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  return (
    <div className="flex items-center gap-3 rounded-lg border border-brand-cyan/25 bg-brand-cyan-light/40 px-3 py-2">
      <Sparkles className="size-4 text-brand-cyan-deep shrink-0" />
      <div className="min-w-0 flex-1 text-sm">
        <span className="font-semibold text-foreground">Next: {label}</span>
        {hint && <span className="text-muted-foreground"> — {hint}</span>}
      </div>
      <button
        type="button"
        onClick={goToBlueprint}
        className="btn-primary text-xs inline-flex items-center gap-1 shrink-0"
      >
        Do it <ArrowRight className="size-3.5" />
      </button>
    </div>
  );
}
