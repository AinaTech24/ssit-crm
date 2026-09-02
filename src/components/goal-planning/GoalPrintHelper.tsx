"use client";

/**
 * Print toolbar for the goal-print page.
 *
 *   - Auto-fires window.print() once on mount (unless ?autoprint=0)
 *   - Renders a small toolbar at the top of the page (hidden on print) with
 *     "Switch view", "Back", and a manual "Save as PDF / Print" button.
 */

import { useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

export function GoalPrintHelper({
  goalId,
  view,
  investorName,
}: {
  goalId: string;
  view: "summary" | "detailed";
  investorName: string;
}) {
  const params = useSearchParams();
  useEffect(() => {
    if (params.get("autoprint") === "0") return;
    const t = setTimeout(() => {
      try {
        window.print();
      } catch {
        /* ignore */
      }
    }, 350);
    return () => clearTimeout(t);
  }, [params]);

  const otherView = view === "summary" ? "detailed" : "summary";

  return (
    <div className="print:hidden bg-secondary/40 border-b border-border px-6 py-3 flex items-center justify-between sticky top-0 z-10 backdrop-blur">
      <div className="text-sm text-muted-foreground">
        {view === "summary" ? "Goal — Summary report" : "Goal — Detailed report"} ·{" "}
        <span className="font-medium text-foreground">{investorName}</span>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href={`/dashboard/goals/${goalId}/print?view=${otherView}&autoprint=0`}
          className="btn-ghost text-xs"
        >
          Switch to {otherView}
        </Link>
        <Link href={`/dashboard/goals/${goalId}`} className="btn-secondary text-xs">
          Back
        </Link>
        <button onClick={() => window.print()} className="btn-primary text-xs">
          Save as PDF / Print
        </button>
      </div>
    </div>
  );
}
