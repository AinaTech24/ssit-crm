"use client";

/**
 * One-click "Create rebalance task" for a drifted row on the Risk-Drift Radar.
 * POSTs the existing /api/tasks endpoint (same body shape as the task editor):
 * follow_up task on the investor, priority high, assigned to the client's RM
 * when one is set. If the caller can't assign to others (task.edit.assigned
 * only → API 403s on foreign assignee), it retries assigned to self.
 */

import { useState } from "react";
import { Check, ClipboardPlus, Loader2 } from "lucide-react";

type Props = {
  investorId: string;
  investorName: string;
  /** Actual equity %, already rounded for display. */
  equityPct: number;
  /** Target band label, e.g. "30–60%". */
  bandLabel: string;
  rmId?: string | null;
};

export function CreateRebalanceTaskButton({ investorId, investorName, equityPct, bandLabel, rmId }: Props) {
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");

  async function create() {
    if (state === "saving" || state === "done") return;
    setState("saving");

    const base = {
      title: `Rebalance review: ${investorName} (${Math.round(equityPct)}% equity vs ${bandLabel} target)`,
      type: "follow_up",
      subjectType: "investor" as const,
      subjectId: investorId,
      relatedInvestorId: investorId,
      priority: "high" as const,
    };

    try {
      let res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rmId ? { ...base, assigneeId: rmId } : base),
      });
      // 403 with an RM assignee = caller may only self-assign; fall back.
      if (!res.ok && res.status === 403 && rmId) {
        res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(base),
        });
      }
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
        <Check className="size-3.5" /> Task created
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={create}
      disabled={state === "saving"}
      className="btn-secondary text-xs inline-flex items-center gap-1 disabled:opacity-60"
      title="Create a high-priority rebalance follow-up task on this client"
    >
      {state === "saving" ? <Loader2 className="size-3.5 animate-spin" /> : <ClipboardPlus className="size-3.5" />}
      {state === "error" ? "Retry" : "Rebalance task"}
    </button>
  );
}
