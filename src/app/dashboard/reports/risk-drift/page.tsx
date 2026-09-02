/**
 * Risk-Drift Radar — clients whose ACTUAL portfolio equity allocation has
 * drifted outside the target band implied by their signed risk profile.
 * Compliance-flavoured intelligence: suitability drift is what an inspector
 * asks about, and what a good MFD fixes before they do. Each drifted row has a
 * one-click "Rebalance task" that lands on the client's RM.
 * Methodology lives in src/lib/reports/risk-drift.ts.
 */

import Link from "next/link";
import { Radar, Scale, TrendingUp, TrendingDown, Users } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny, can } from "@/lib/auth/rbac";
import { users } from "@/db/schema";
import { formatINR } from "@/lib/utils";
import { CreateRebalanceTaskButton } from "@/components/reports/CreateRebalanceTaskButton";
import {
  computeRiskDrift,
  riskProfileChipClasses,
  RISK_PROFILE_LABELS,
  type RiskDriftRow,
} from "@/lib/reports/risk-drift";

export const dynamic = "force-dynamic";

export default async function RiskDriftPage() {
  const session = await requireSession();
  requireAny(session.roles, ["reports.business", "reports.team", "investor.view.all", "investor.view.assigned"], session.permissions);

  // Managers see the firm; a plain RM (assigned-scope only) sees just their book.
  const seesAll =
    can(session.roles, "investor.view.all", session.permissions) ||
    can(session.roles, "reports.business", session.permissions) ||
    can(session.roles, "reports.team", session.permissions);

  const data = await withTenant(session.tenantId, async (tx) => {
    const { rows, summary } = await computeRiskDrift(tx, session.tenantId, {
      rmId: seesAll ? undefined : session.userId,
    });
    const rmRows = await tx.select({ id: users.id, name: users.name }).from(users);
    const rmMap = new Map(rmRows.map((r) => [r.id, r.name]));
    return { rows, summary, rmMap };
  });

  const drifted = data.rows.filter((r) => r.driftPts > 0);

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="page-title">
          <Radar className="size-6 text-amber-500" /> Risk-drift radar
        </h1>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={Users} label="Clients checked" value={String(data.summary.checked)} />
        <Stat icon={Scale} label="Drifted" value={String(data.summary.drifted)} tone={data.summary.drifted > 0 ? "amber" : undefined} />
        <Stat icon={TrendingUp} label="Too aggressive" value={String(data.summary.tooAggressive)} tone={data.summary.tooAggressive > 0 ? "rose" : undefined} />
        <Stat icon={TrendingDown} label="Too conservative" value={String(data.summary.tooConservative)} tone={data.summary.tooConservative > 0 ? "amber" : undefined} />
      </div>

      <div className="card-surface overflow-hidden">
        {drifted.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <Radar className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2 font-medium">No drift detected — or import holdings first (RTA File Imports).</div>
            <p className="mt-2 text-xs max-w-md mx-auto">
              This radar compares each client&apos;s actual equity allocation (from imported folio
              holdings) against the target band implied by their signed risk profile. Clients need
              both a risk profile and folio AUM to be checked.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Client</th>
                <th className="text-left py-2 font-medium">Risk profile</th>
                <th className="text-left py-2 font-medium">Target band</th>
                <th className="text-right py-2 font-medium">Actual equity</th>
                <th className="text-right py-2 font-medium">Drift</th>
                <th className="text-left py-2 pl-6 font-medium">RM</th>
                <th className="text-right py-2 font-medium">AUM</th>
                <th className="text-right px-4 py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {drifted.map((r) => {
                const bandLabel = `${r.band.min}–${r.band.max}%`;
                return (
                  <tr key={r.investorId} className="border-b last:border-0 hover:bg-secondary/40 align-top">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/investors/${r.investorId}`} className="font-medium hover:underline">
                        {r.name}
                      </Link>
                      <div className="text-[10px] text-muted-foreground">
                        {r.direction === "too_aggressive" ? "More equity than the profile allows" : "Less equity than the profile targets"}
                      </div>
                    </td>
                    <td className="py-3">
                      <span className={`chip border ${riskProfileChipClasses(r.riskProfile)}`}>
                        {RISK_PROFILE_LABELS[r.riskProfile]}
                      </span>
                    </td>
                    <td className="py-3 text-xs tabular-nums text-muted-foreground">{bandLabel} equity</td>
                    <td className={`py-3 text-right tabular-nums font-semibold ${equityTone(r)}`}>
                      {r.equityPct.toFixed(1)}%
                    </td>
                    <td className="py-3 text-right tabular-nums">
                      <span className={r.driftPts > 15 ? "text-rose-600 font-semibold" : "text-amber-600 font-medium"}>
                        {r.direction === "too_aggressive" ? "+" : "−"}
                        {r.driftPts.toFixed(1)} pts
                      </span>
                    </td>
                    <td className="py-3 pl-6 text-xs text-muted-foreground">
                      {r.rmId ? data.rmMap.get(r.rmId) ?? "—" : "—"}
                    </td>
                    <td className="py-3 text-right tabular-nums">{r.aum > 0 ? formatINR(r.aum) : "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <CreateRebalanceTaskButton
                        investorId={r.investorId}
                        investorName={r.name}
                        equityPct={r.equityPct}
                        bandLabel={bandLabel}
                        rmId={r.rmId}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground italic">
        Methodology: schemes are classified equity / debt / hybrid from the imported category (name
        fallback); hybrid counts as 65% equity. Target bands — Conservative 0&ndash;30%, Moderate
        30&ndash;60%, Aggressive 55&ndash;85%, Very aggressive 70&ndash;100% equity. Top 500 clients
        by AUM with a signed risk profile and imported holdings are checked.
      </p>
    </div>
  );
}

/** Amber for moderate drift, rose when the allocation is way outside the band. */
function equityTone(r: RiskDriftRow): string {
  if (r.driftPts <= 0) return "text-foreground";
  return r.driftPts > 15 ? "text-rose-600" : "text-amber-600";
}

function Stat({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone?: "rose" | "amber" }) {
  return (
    <div className="kpi-card">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</span>
        <Icon className="size-3.5 text-muted-foreground" />
      </div>
      <div
        className={`text-2xl font-bold mt-1 tabular-nums ${tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-600" : "text-foreground"
          }`}
      >
        {value}
      </div>
    </div>
  );
}
