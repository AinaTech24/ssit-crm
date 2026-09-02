"use client";

/**
 * Referral-ask button (Referral Radar report) — one click creates a follow-up
 * task for the client's RM: "Referral ask: <name>". The task description
 * carries the happy-client signals that put the client on the radar, so the
 * RM knows exactly WHY this is a good moment to ask.
 *
 * Mirrors the POST /api/tasks body shape (src/app/api/tasks/route.ts). If the
 * caller lacks task.edit.all (can only assign to self) the API 403s on a
 * foreign assignee — we retry once without assigneeId so the task lands on
 * the current user instead of failing silently.
 */

import { useState } from "react";
import { Check, UserPlus, AlertCircle } from "lucide-react";

export function ReferralAskButton({
  investorId,
  investorName,
  rmId,
  signals,
}: {
  investorId: string;
  investorName: string;
  rmId: string | null;
  signals: string[];
}) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "err">("idle");

  async function ask() {
    if (state === "busy" || state === "done") return;
    setState("busy");
    try {
      const description =
        "Happy-client signals:\n" +
        signals.map((s) => `• ${s}`).join("\n") +
        "\n\nAsk for an introduction on your next touch.";

      const body: Record<string, unknown> = {
        title: `Referral ask: ${investorName}`,
        description,
        type: "follow_up",
        subjectType: "investor",
        subjectId: investorId,
        relatedInvestorId: investorId,
        priority: "normal",
      };
      if (rmId) body.assigneeId = rmId;

      let res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      // Assigned-scope users may only create tasks for themselves.
      if (res.status === 403 && rmId) {
        const { assigneeId: _drop, ...selfBody } = body;
        res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(selfBody),
        });
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState("done");
    } catch {
      setState("err");
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
      onClick={ask}
      disabled={state === "busy"}
      className="btn-secondary text-xs inline-flex items-center gap-1 disabled:opacity-60"
      title="Create a follow-up task for the RM to ask this client for a referral"
    >
      {state === "err" ? (
        <>
          <AlertCircle className="size-3.5 text-rose-500" /> Retry
        </>
      ) : (
        <>
          <UserPlus className="size-3.5" /> {state === "busy" ? "Creating…" : "Ask for referral"}
        </>
      )}
    </button>
  );
}
