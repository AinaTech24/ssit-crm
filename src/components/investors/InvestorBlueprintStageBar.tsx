"use client";

/**
 * Investor-side blueprint stage bar.
 *
 * Two render modes based on the API response:
 *   1. Source-lead path → the investor was converted from a lead, so we
 *      have a real blueprint instance. Delegate to the existing
 *      <BlueprintStageBar> with phase="client" so the user can re-sync,
 *      view history, etc.
 *   2. Synthetic path → no source lead (direct-imported investor). Render
 *      a static, read-only bar showing the 3 client-phase stages with
 *      the investor pinned at "Active Client". No advance / re-sync
 *      buttons because there's nothing to advance against.
 *
 * Always renders something so the user sees the journey on every client.
 */
import { useEffect, useState } from "react";
import { CheckCircle2, ShieldCheck, Sparkles } from "lucide-react";
import { BlueprintStageBar } from "@/components/leads/BlueprintStageBar";

type ApiData = {
  leadId: string | null;
  synthetic: boolean;
  allStages: Array<{
    key: string;
    name: string;
    order: number;
    status: "done" | "current" | "upcoming";
    phase?: "lead" | "client";
  }>;
  current?: { name: string; order: number };
};

export function InvestorBlueprintStageBar({ investorId }: { investorId: string }) {
  const [data, setData] = useState<ApiData | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/investors/${investorId}/blueprint`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setErr(true);
      });
    return () => {
      cancelled = true;
    };
  }, [investorId]);

  if (err) return null;
  if (!data) {
    return (
      <div className="card-surface p-3 text-xs text-muted-foreground">
        Loading client journey…
      </div>
    );
  }

  // Real lead-backed blueprint → reuse the full component with phase=client.
  if (!data.synthetic && data.leadId) {
    return (
      <BlueprintStageBar
        leadId={data.leadId}
        phase="client"
        convertedInvestorId={investorId}
      />
    );
  }

  // Synthetic / direct-import client — render a small read-only bar.
  return (
    <div className="card-surface p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-brand-cyan" />
          <h3 className="font-semibold text-sm">Client Onboarding</h3>
          <span className="text-xs text-muted-foreground">
            Direct entry · marked as Active Client
          </span>
        </div>
        <span className="chip bg-emerald-50 text-emerald-700 text-[10px] inline-flex items-center gap-1">
          <CheckCircle2 className="size-3" /> Active
        </span>
      </div>

      <div className="overflow-x-auto scrollbar-thin">
        <ol className="flex items-center min-w-max gap-0.5">
          {data.allStages.map((s, i) => (
            <li key={s.key} className="flex items-center">
              <div className="flex flex-col items-center min-w-[80px]">
                <div
                  className={`size-7 rounded-full grid place-items-center text-[10px] font-bold ${
                    s.status === "done"
                      ? "bg-emerald-500 text-white"
                      : s.status === "current"
                        ? "bg-brand-cyan text-white ring-2 ring-brand-cyan/30"
                        : "bg-secondary text-muted-foreground"
                  }`}
                  title={s.name}
                >
                  {s.status === "done" ? "✓" : s.order}
                </div>
                <span
                  className={`mt-1 text-[10px] text-center leading-tight max-w-[90px] ${
                    s.status === "current" ? "font-semibold" : "text-muted-foreground"
                  }`}
                >
                  {s.name}
                </span>
              </div>
              {i < data.allStages.length - 1 && (
                <div
                  className={`h-0.5 w-10 mx-0.5 mb-5 ${
                    s.status === "done" ? "bg-emerald-400" : "bg-border"
                  }`}
                />
              )}
            </li>
          ))}
        </ol>
      </div>

      <div className="text-xs text-muted-foreground bg-secondary/40 rounded-lg p-2.5 border border-border/60 flex items-start gap-2">
        <Sparkles className="size-3.5 mt-0.5 flex-shrink-0 text-brand-cyan" />
        <span>
          This client was added directly (not converted from a lead), so the
          14-stage Lead → Client journey was skipped. From here, the CRM
          tracks reviews, transactions, service requests and goals.
        </span>
      </div>
    </div>
  );
}
