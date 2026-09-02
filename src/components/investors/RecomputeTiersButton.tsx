"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Layers, Loader2 } from "lucide-react";

export function RecomputeTiersButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ counts?: Record<string, number>; recomputed?: number } | null>(null);

  async function go() {
    if (!confirm("Recompute service tiers (A/B/C) for all active investors?")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/investors/recompute-tiers", { method: "POST" });
      const j = await res.json();
      setResult(j);
      router.refresh();
      setTimeout(() => setResult(null), 5000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={go}
        disabled={busy}
        className="rounded-md border px-3 py-1.5 text-sm flex items-center gap-1.5 hover:bg-accent disabled:opacity-50"
        title="Top 20% by AUM → A (quarterly), next 30% → B (half-yearly), rest → C (annual)"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Layers className="size-4" />}
        {busy ? "Recomputing…" : "Recompute tiers"}
      </button>
      {result && (
        <div className="absolute right-0 top-full mt-1 border bg-card rounded-md shadow-md p-3 text-xs z-10 min-w-[200px]">
          <div className="font-medium mb-1">✓ {result.recomputed} investors retiered</div>
          {result.counts && (
            <div className="text-muted-foreground space-y-0.5">
              <div>Tier A: <span className="font-medium">{result.counts.A ?? 0}</span></div>
              <div>Tier B: <span className="font-medium">{result.counts.B ?? 0}</span></div>
              <div>Tier C: <span className="font-medium">{result.counts.C ?? 0}</span></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
