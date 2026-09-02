import Link from "next/link";
import { ChevronLeft, Clock, Building2 } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { formatINR } from "@/lib/utils";
import { loadAgingBuckets, loadInsurerScorecard, type AgingBucket } from "@/lib/insurance/claims-analytics";

export const dynamic = "force-dynamic";

const AGING_TONE = [
  "text-emerald-600",
  "text-amber-600",
  "text-amber-700",
  "text-rose-600",
];

export default async function ClaimsScorecardPage() {
  const session = await requireSession();
  requireCap(session.roles, "insurance.view", session.permissions);

  const { aging, scorecard } = await withTenant(session.tenantId, async (tx) => {
    const [aging, scorecard] = await Promise.all([
      loadAgingBuckets(tx, session.tenantId),
      loadInsurerScorecard(tx, session.tenantId),
    ]);
    return { aging, scorecard };
  });

  return (
    <div className="space-y-5 max-w-7xl">
      <div>
        <Link
          href="/dashboard/insurance-claims"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2"
        >
          <ChevronLeft className="size-3.5" /> Insurance Claims
        </Link>
        <h1 className="page-title"><Clock className="size-6 text-brand-cyan" /> Settlement Scorecard</h1>
        <p className="page-subtitle">Open-claim aging and per-insurer settlement performance (TAT & approval rate).</p>
      </div>

      {/* Aging buckets */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Open claims — aging</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {aging.map((b, i) => (
            <AgingCard key={b.label} bucket={b} tone={AGING_TONE[i]} />
          ))}
        </div>
      </div>

      {/* Insurer scorecard */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Insurer settlement scorecard</h2>
        <div className="card-surface overflow-hidden">
          {scorecard.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              <Building2 className="size-8 mx-auto text-muted-foreground/40" />
              <div className="mt-2 font-medium">No claims with an insurer recorded yet.</div>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b bg-secondary/30">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Insurer</th>
                    <th className="text-right py-2 font-medium">Total</th>
                    <th className="text-right py-2 font-medium">Settled</th>
                    <th className="text-right py-2 font-medium">Rejected</th>
                    <th className="text-right py-2 font-medium">Approval %</th>
                    <th className="text-right py-2 font-medium">Avg TAT (days)</th>
                    <th className="text-right py-2 font-medium pr-4">Settled ₹</th>
                  </tr>
                </thead>
                <tbody>
                  {scorecard.map((r) => {
                    const tatTone =
                      r.avgTatDays != null && r.avgTatDays > 60
                        ? "bg-rose-50 text-rose-700"
                        : r.avgTatDays != null && r.avgTatDays > 30
                        ? "bg-amber-50 text-amber-700"
                        : "text-muted-foreground";
                    const apprTone =
                      r.approvalRate != null && r.approvalRate < 0.7
                        ? "bg-rose-50 text-rose-700"
                        : "text-muted-foreground";
                    return (
                      <tr key={r.insurer} className="border-b last:border-0 hover:bg-secondary/40 transition-colors">
                        <td className="px-4 py-2.5 font-medium">{r.insurer}</td>
                        <td className="py-2.5 text-right tabular-nums">{r.total}</td>
                        <td className="py-2.5 text-right tabular-nums text-emerald-700">{r.settled}</td>
                        <td className="py-2.5 text-right tabular-nums text-rose-700">{r.rejected}</td>
                        <td className="py-2.5 text-right">
                          {r.approvalRate == null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span className={`chip ${apprTone}`}>{Math.round(r.approvalRate * 100)}%</span>
                          )}
                        </td>
                        <td className="py-2.5 text-right">
                          {r.avgTatDays == null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span className={`chip ${tatTone}`}>{r.avgTatDays}</span>
                          )}
                        </td>
                        <td className="py-2.5 text-right tabular-nums pr-4">{formatINR(r.settledAmount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Approval % = settled ÷ (settled + rejected) over decided claims. Avg TAT = average days from intimation to
          settlement over settled claims. Amber TAT &gt; 30 days, rose &gt; 60; approval below 70% flagged rose.
        </p>
      </div>
    </div>
  );
}

function AgingCard({ bucket, tone }: { bucket: AgingBucket; tone: string }) {
  return (
    <div className="kpi-card">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">{bucket.label}</span>
        <Clock className={`size-4 ${tone}`} />
      </div>
      <div className={`text-2xl font-bold mt-1.5 tabular-nums ${tone}`}>{bucket.count}</div>
      <div className="text-xs text-muted-foreground mt-0.5 tabular-nums">{formatINR(bucket.amount)}</div>
    </div>
  );
}
