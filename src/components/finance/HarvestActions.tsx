"use client";

import { useState } from "react";
import { ListPlus, Loader2, CheckCircle2 } from "lucide-react";

/**
 * One-click "create follow-up task" for a tax-harvesting opportunity. Turns the
 * report from a read-only list into an actioned worklist — the task lands on the
 * RM with the harvest plan in the description and links back to the client.
 */
export function HarvestTaskButton({
  investorId,
  investorName,
  harvestable,
  taxSaved,
  plan,
}: {
  investorId: string;
  investorName: string;
  harvestable: number;
  taxSaved: number;
  plan: string;
}) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "err">("idle");
  const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

  async function create() {
    setState("busy");
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: `Harvest LTCG for ${investorName} — book ${inr(harvestable)} tax-free`,
          description:
            `Tax-harvesting opportunity. Redeem long-term equity units to realise ~${inr(harvestable)} of LTCG within this year's exemption ` +
            `(saves ~${inr(taxSaved)} of tax), then re-buy the same scheme to step up the cost basis.\n\n` +
            `Suggested plan:\n${plan}\n\n` +
            `Confirm exact units against the client's CAS before transacting. Harvest before 31 March — the allowance doesn't carry forward.`,
          type: "follow_up",
          subjectType: "investor",
          subjectId: investorId,
          priority: "high",
        }),
      });
      setState(res.ok ? "done" : "err");
    } catch {
      setState("err");
    }
  }

  if (state === "done")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
        <CheckCircle2 className="size-3.5" /> Task created
      </span>
    );

  return (
    <button
      onClick={create}
      disabled={state === "busy"}
      className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-50"
      title="Create a high-priority follow-up task for the RM"
    >
      {state === "busy" ? <Loader2 className="size-3.5 animate-spin" /> : <ListPlus className="size-3.5" />}
      {state === "err" ? "Retry" : "Create task"}
    </button>
  );
}
