"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";

/**
 * A real, tick-able checkbox for the reference checklists (marketing assets,
 * finance checklist). These were previously static decorative boxes, so users
 * couldn't mark items done. State persists per-browser in localStorage, keyed
 * by a stable storageKey, so ticks survive reloads.
 */
export function ChecklistBox({ storageKey }: { storageKey: string }) {
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    try {
      setChecked(localStorage.getItem(storageKey) === "1");
    } catch {
      /* localStorage unavailable — fall back to in-memory only */
    }
  }, [storageKey]);

  function toggle() {
    setChecked((c) => {
      const next = !c;
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={toggle}
      className={`mt-0.5 size-4 rounded border flex-shrink-0 grid place-items-center transition-colors ${
        checked
          ? "bg-brand-cyan border-brand-cyan text-white"
          : "border-border bg-card hover:border-brand-cyan"
      }`}
    >
      {checked && <Check className="size-3" strokeWidth={3} />}
    </button>
  );
}
