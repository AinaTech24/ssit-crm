"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export function RecalculateButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function recompute() {
    setBusy(true);
    try {
      const res = await fetch("/api/compliance/recompute", {
        method: "POST",
      });
      if (res.ok) {
        router.refresh();
      } else {
        alert("Failed to recalculate compliance readiness score.");
      }
    } catch (error) {
      console.error(error);
      alert("Error recalculating score.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={recompute}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-md border border-amber-200/50 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300 dark:hover:bg-amber-950/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} />
      {busy ? "Recalculating..." : "Recalculate score"}
    </button>
  );
}
