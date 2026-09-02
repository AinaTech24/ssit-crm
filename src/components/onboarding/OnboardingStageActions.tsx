"use client";

/**
 * Client component for advancing an onboarding pipeline.
 *
 * Lets the RM (or back-office) mark the current stage done — captures
 * optional remarks and updates `pendingDocuments`. Posts to
 * `POST /api/onboarding/[id]/stage`, which handles all 3 automations
 * server-side (next-stage task, document alert, welcome comm).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, X } from "lucide-react";

const STAGE_LABELS: Record<string, string> = {
  first_meeting: "First Meeting Done",
  documents: "Documents Collected",
  kyc: "KYC Checked",
  risk_profile: "Risk Profile Completed",
  goal_mapping: "Goal Mapping Done",
  ucc_can: "UCC / CAN Created",
  mandate: "Mandate Registered",
  plan_shared: "Investment Plan Shared",
  first_investment: "SIP / Lumpsum Started",
  welcome_kit: "Welcome Kit Sent",
  first_review: "First Review Scheduled",
};

export function OnboardingStageActions({
  pipelineId,
  currentStage,
  doneStages,
}: {
  pipelineId: string;
  currentStage: string;
  doneStages: string[];
}) {
  const router = useRouter();
  const [stage, setStage] = useState(currentStage);
  // After a successful submit we call router.refresh(), which re-runs the
  // server component and feeds a fresh `currentStage` prop. useState seeds only
  // once, so without this sync the dropdown would keep showing the
  // just-completed stage. Re-sync the selection to the server's new truth.
  useEffect(() => {
    setStage(currentStage);
  }, [currentStage]);
  const [remarks, setRemarks] = useState("");
  const [docInput, setDocInput] = useState("");
  const [pendingDocs, setPendingDocs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isDone = doneStages.includes(stage);

  function addDoc() {
    const d = docInput.trim();
    if (!d) return;
    if (pendingDocs.includes(d)) return;
    setPendingDocs([...pendingDocs, d]);
    setDocInput("");
  }

  function removeDoc(d: string) {
    setPendingDocs(pendingDocs.filter((x) => x !== d));
  }

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/onboarding/${pipelineId}/stage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          stage,
          remarks: remarks || undefined,
          pendingDocuments: pendingDocs.length > 0 ? pendingDocs : undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Save failed");
        return;
      }
      setRemarks("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border rounded-lg bg-card p-5 space-y-3">
      <h2 className="font-semibold">Advance stage</h2>

      <label className="block">
        <div className="text-xs font-medium mb-1">Mark stage done</div>
        <select
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          className="w-full border rounded-md px-3 py-2 text-sm bg-background"
        >
          {Object.entries(STAGE_LABELS).map(([key, label]) => (
            <option key={key} value={key} disabled={doneStages.includes(key)}>
              {label} {doneStages.includes(key) ? "(done)" : ""}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <div className="text-xs font-medium mb-1">Remarks (optional)</div>
        <textarea
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          rows={2}
          placeholder="What happened in this stage? Any blockers?"
          className="w-full border rounded-md px-3 py-2 text-sm bg-background"
        />
      </label>

      <div>
        <div className="text-xs font-medium mb-1">Pending documents (optional)</div>
        <div className="flex gap-2">
          <input
            value={docInput}
            onChange={(e) => setDocInput(e.target.value)}
            placeholder="e.g. Aadhaar copy, FATCA form"
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addDoc())}
            className="flex-1 border rounded-md px-3 py-2 text-sm bg-background"
          />
          <button
            type="button"
            onClick={addDoc}
            className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
          >
            + Add
          </button>
        </div>
        {pendingDocs.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {pendingDocs.map((d) => (
              <span
                key={d}
                className="text-xs bg-amber-50 text-amber-900 border border-amber-200 px-2 py-0.5 rounded-full inline-flex items-center gap-1"
              >
                {d}
                <button type="button" onClick={() => removeDoc(d)} className="hover:text-rose-700">
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <p className="text-[10px] text-muted-foreground mt-1.5">
          Listed documents will fire an in-app alert to back-office users.
        </p>
      </div>

      {err && <div className="text-sm text-rose-600">{err}</div>}

      <div className="flex justify-end gap-2 pt-2 border-t">
        <button
          onClick={submit}
          disabled={busy || isDone}
          className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50 flex items-center gap-1.5"
        >
          {busy ? "Saving…" : (
            <>
              <Check className="size-4" /> Mark {STAGE_LABELS[stage]?.toLowerCase()}
              <ArrowRight className="size-4 ml-1" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
