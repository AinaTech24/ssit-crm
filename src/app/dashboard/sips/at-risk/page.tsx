import Link from "next/link";
import { ShieldAlert, AlertTriangle, Repeat, IndianRupee } from "lucide-react";
import { ModuleTabs, SIP_TABS } from "@/components/common/ModuleTabs";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { findAtRiskSips, SIP_RISK_LABEL, type SipRiskReason } from "@/lib/finance/sip-defense";
import { formatINR, formatDate } from "@/lib/utils";
import { DefendSipButton } from "@/components/sip-rejections/DefendSipButton";

export const dynamic = "force-dynamic";

const ALLOWED = ["owner", "branch_head", "rm", "back_office", "ops"];

const REASON_TONE: Record<SipRiskReason, string> = {
  dead_mandate: "bg-rose-50 text-rose-700",
  repeated_failures: "bg-rose-50 text-rose-700",
  mandate_expiring: "bg-amber-50 text-amber-700",
  ending_soon: "bg-blue-50 text-blue-700",
};

function formatCr(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return formatINR(n);
}

export default async function SipAtRiskPage() {
  const session = await requireSession();
  if (!session.roles.some((r) => ALLOWED.includes(r))) {
    return (
      <div className="max-w-2xl mx-auto mt-12 card-surface p-8 text-center">
        <AlertTriangle className="size-8 text-amber-600 mx-auto" />
        <h1 className="text-xl font-bold mt-3">Not available for your role</h1>
      </div>
    );
  }

  // RMs see only their own at-risk SIPs; managers/ops see the whole firm.
  const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "reports.business", session.permissions);
  const data = await withTenant(
    session.tenantId,
    async (tx) => findAtRiskSips(tx, session.tenantId, { rmId: seesAll ? null : session.userId }),
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="page-title">
          <ShieldAlert className="size-6 text-rose-600" /> SIP At-Risk — save before they stop
        </h1>
      </div>

      <ModuleTabs tabs={SIP_TABS} />

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="kpi-card">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground flex items-center gap-1.5">
            <ShieldAlert className="size-4" /> At-risk SIPs
          </div>
          <div className="text-2xl font-bold mt-1.5 tabular-nums">{data.counts.total}</div>
          <div className="text-[11px] mt-0.5 text-muted-foreground">
            <span className="text-rose-700 font-semibold">{data.counts.high} high</span> · {data.counts.medium} medium
          </div>
        </div>
        <div className="kpi-card">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground flex items-center gap-1.5">
            <Repeat className="size-4" /> Monthly inflow at risk
          </div>
          <div className="text-2xl font-bold mt-1.5 tabular-nums">{formatINR(data.monthlyValueAtRisk)}</div>
          <div className="text-[11px] mt-0.5 text-muted-foreground">if these SIPs stop</div>
        </div>
        <div className="kpi-card md:col-span-2">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground flex items-center gap-1.5">
            <IndianRupee className="size-4" /> Annual trail exposed
          </div>
          <div className="text-2xl font-bold mt-1.5 tabular-nums text-rose-700">
            {formatINR(data.annualTrailAtRisk)}
          </div>
          <div className="text-[11px] mt-0.5 text-muted-foreground">
            estimated trail lost per year if unaddressed
          </div>
        </div>
      </div>

      {/* Queue */}
      {data.atRisk.length === 0 ? (
        <div className="card-surface p-8 text-center">
          <ShieldAlert className="size-8 text-emerald-600 mx-auto" />
          <h2 className="text-lg font-semibold mt-3">No SIPs at risk 🎉</h2>
          <p className="text-muted-foreground text-sm mt-1">
            No active SIP has a dead/expiring mandate, repeated failures, or an imminent end date.
          </p>
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <div className="table-scroll">
            <table className="w-full text-sm table-modern">
              <thead className="sticky top-0 z-10 bg-card">
                <tr>
                  <th className="text-left px-4 py-2.5">Investor</th>
                  <th className="text-left px-4 py-2.5">AMC / Scheme</th>
                  <th className="text-right px-4 py-2.5">SIP</th>
                  <th className="text-left px-4 py-2.5">Risk</th>
                  <th className="text-left px-4 py-2.5">RM</th>
                  <th className="text-right px-4 py-2.5">Trail exposed</th>
                  <th className="text-right px-4 py-2.5">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.atRisk.map((s) => (
                  <tr key={s.sipId}>
                    <td className="px-4 py-2.5">
                      <Link href={`/dashboard/investors/${s.investorId}`} className="font-medium hover:underline">
                        {s.investorName}
                      </Link>
                      {s.riskLevel === "high" && (
                        <span className="ml-2 chip bg-rose-50 text-rose-700 text-[10px]">High</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="text-xs">{s.amcName ?? "—"}</div>
                      <div className="text-[11px] text-muted-foreground truncate max-w-[200px]">{s.schemeName ?? "—"}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      <div className="font-medium">{formatINR(s.amount)}</div>
                      <div className="text-[11px] text-muted-foreground capitalize">{s.frequency}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {s.reasons.map((r) => (
                          <span key={r} className={`chip text-[10px] ${REASON_TONE[r]}`}>
                            {SIP_RISK_LABEL[r]}
                          </span>
                        ))}
                      </div>
                      {s.endDate && s.reasons.includes("ending_soon") && (
                        <div className="text-[10px] text-muted-foreground mt-0.5">ends {formatDate(s.endDate)}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{s.rmName ?? "Unassigned"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-xs">{formatINR(s.annualTrailExposed)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <DefendSipButton sipId={s.sipId} reasons={s.reasons.map((r) => SIP_RISK_LABEL[r])} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
