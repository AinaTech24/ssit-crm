"use client";

/**
 * "Other activity" — logs day-to-day work that isn't a client task. Pick a kind
 * (bank work, AMC work, BA service, other) and the full New task form opens for
 * it, with description, remarks, attachments, related client, due date and the
 * rest. It is stored as a task of type `other_activity` and listed under
 * Tasks → Other activity.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, ChevronDown } from "lucide-react";

const KINDS = [
  { key: "bank_work", label: "Bank work" },
  { key: "amc_work", label: "AMC work" },
  { key: "ba_service", label: "BA service" },
  { key: "other", label: "Other" },
] as const;

export function OtherActivityButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="rounded-md border px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 hover:bg-accent"
      >
        <Briefcase className="size-4" /> Other activity <ChevronDown className="size-3.5 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-72 rounded-lg border bg-card p-2 shadow-lg">
          <div className="flex flex-col">
            <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              What kind of activity?
            </div>
            {KINDS.map((k) => (
              <button
                key={k.key}
                type="button"
                onClick={() => {
                  setOpen(false);
                  router.push(`/dashboard/tasks/new?activity=${k.key}`);
                }}
                className="rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
