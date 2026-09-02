"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Loader2 } from "lucide-react";

export function ReconcileButton({ period }: { period: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  async function run() {
    setBusy(true);
    try {
      const res = await fetch("/api/commission/reconcile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ period }),
      });
      const j = await res.json();
      setResult(j);
      router.refresh();
      setTimeout(() => setResult(null), 6000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={run}
        disabled={busy}
        className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        {busy ? "Reconciling…" : "Recompute reconciliation"}
      </button>
      {result && !result.error && (
        <div className="absolute right-0 top-full mt-1 border bg-card rounded-md shadow-md p-3 text-xs z-10 min-w-[240px]">
          <div className="font-medium mb-1">✓ {result.rowsComputed} lines reconciled</div>
          <div className="text-muted-foreground space-y-0.5">
            <div>Anomalies flagged: <span className="font-medium">{result.anomalies}</span></div>
            <div>Total variance: ₹{Math.round(result.totalVariance).toLocaleString("en-IN")}</div>
          </div>
        </div>
      )}
      {result?.error && (
        <div className="absolute right-0 top-full mt-1 border border-rose-300 bg-rose-50 rounded-md shadow-md p-3 text-xs z-10 min-w-[240px] text-rose-700">
          {result.error}
        </div>
      )}
    </div>
  );
}
