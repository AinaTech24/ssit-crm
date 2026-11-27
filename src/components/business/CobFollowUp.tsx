"use client";

/**
 * The change-of-broker check at the bottom of a business entry: is it done? Yes - or No, with the reason.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function CobFollowUp({
  entryId,
  status,
  dueOn,
  isDue,
  reason,
  answeredBy,
  answeredAt,
}: {
  entryId: string;
  status: string;
  dueOn: string;
  isDue: boolean;
  reason: string | null;
  answeredBy: string | null;
  answeredAt: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [answer, setAnswer] = useState<"yes" | "no" | "">(status === "done" ? "yes" : status === "not_done" ? "no" : "");
  const [why, setWhy] = useState(reason ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const r = await fetch(`/api/business-entries/${entryId}/cob`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ done: answer === "yes", reason: answer === "no" ? why.trim() : undefined }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(j.error ?? `Save failed (${r.status})`, "Change of broker");
        return;
      }
      toast.success("Saved", "Change of broker");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const canSave = answer === "yes" || (answer === "no" && why.trim().length > 0);

  return (
    <div id="cob" className={`card-surface p-4 space-y-3 ${status === "pending" && isDue ? "border-primary" : ""}`}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h2 className="font-semibold">Change of broker (COB) - is it done?</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Check due on {fmt(dueOn)}
            {status === "pending" ? (isDue ? " - due now" : "") : ""}
            {answeredBy ? ` · answered by ${answeredBy}${answeredAt ? ` on ${answeredAt}` : ""}` : ""}
          </p>
        </div>
        <span className="chip text-[11px] bg-secondary">{status === "done" ? "Done" : status === "not_done" ? "Not done" : "Pending"}</span>
      </div>
      <div className="flex items-center gap-5 text-sm">
        {(["yes", "no"] as const).map((v) => (
          <label key={v} className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" className="size-4 rounded" checked={answer === v} onChange={() => setAnswer(answer === v ? "" : v)} />
            {v === "yes" ? "Yes, done" : "No"}
          </label>
        ))}
      </div>
      {answer === "no" && (
        <label className="block">
          <div className="text-xs font-medium mb-1">
            Reason<span className="text-destructive ml-0.5">*</span>
          </div>
          <textarea value={why} onChange={(e) => setWhy(e.target.value)} rows={3} maxLength={1000} className="input-base w-full" placeholder="Why is the change of broker not done?" />
        </label>
      )}
      <button type="button" onClick={save} disabled={busy || !canSave} className="btn-primary text-sm inline-flex items-center gap-1.5">
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save
      </button>
    </div>
  );
}
