"use client";

/**
 * "Recompute now" — re-derives this goal's progress / required-SIP / gap / status
 * off live linked folios + active SIPs, on demand (instead of waiting for the
 * nightly job). POSTs to /api/goals/[id]/recompute, then refreshes the page.
 */

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";

export function RecomputeGoalButton({ goalId }: { goalId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function recompute() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/goals/${goalId}/recompute`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error ?? `Recompute failed (${res.status})`, "Couldn't refresh the goal");
        return;
      }
      toast.success("Goal refreshed from live investments");
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Network error", "Couldn't refresh the goal");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button onClick={recompute} disabled={busy} className="btn-secondary text-xs disabled:opacity-50">
      <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} /> Recompute now
    </button>
  );
}
