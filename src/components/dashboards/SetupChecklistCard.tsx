"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, ChevronRight, X } from "lucide-react";

export type SetupStep = {
  key: string;
  label: string;
  hint: string;
  href: string;
  done: boolean;
};

const DISMISS_KEY = "ssit:setup-checklist-dismissed:v1";

/**
 * Presentational half of the setup checklist. Dismiss hides it on this device
 * (localStorage); the server half stops rendering it entirely once every step
 * is verified done, so the dismissal is only ever a temporary "not now".
 */
export function SetupChecklistCard({ steps }: { steps: SetupStep[] }) {
  const [hidden, setHidden] = useState(true); // start hidden to avoid a flash before the localStorage read
  useEffect(() => {
    try {
      setHidden(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setHidden(false);
    }
  }, []);
  if (hidden) return null;

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div className="card-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">Get set up</div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {doneCount} of {steps.length} done — finish these and the CRM starts working for you on its own.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
            setHidden(true);
          }}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label="Hide setup checklist"
          title="Hide for now"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Progress */}
      <div className="mt-3 h-1.5 rounded-full bg-secondary overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${Math.max(6, (doneCount / steps.length) * 100)}%` }}
        />
      </div>

      <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {steps.map((s) => (
          <li key={s.key}>
            {s.done ? (
              <div className="flex items-start gap-2.5 rounded-lg border border-border bg-secondary/40 px-3 py-2.5 opacity-70">
                <CheckCircle2 className="size-4 text-emerald-600 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium line-through decoration-border">{s.label}</div>
                </div>
              </div>
            ) : (
              <Link
                href={s.href}
                className="flex items-start gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 hover:bg-accent/40 transition-colors group"
              >
                <Circle className="size-4 text-muted-foreground/50 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{s.label}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{s.hint}</div>
                </div>
                <ChevronRight className="size-4 text-muted-foreground/40 mt-0.5 shrink-0 group-hover:text-foreground transition-colors" />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
