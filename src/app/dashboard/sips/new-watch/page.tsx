import Link from "next/link";
import { ArrowLeft, ShieldAlert, Activity, CheckCircle2, AlertTriangle } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { formatINR, formatDate } from "@/lib/utils";
import { computeSipInstallmentWatch, type RiskLevel } from "@/lib/finance/sip-installment-watch";
import { InstallmentWatchGrid } from "@/components/sips/InstallmentWatchGrid";

export const dynamic = "force-dynamic";

const ALLOWED = ["owner", "branch_head", "rm", "back_office", "ops"];

const RISK_TONE: Record<RiskLevel, string> = {
  critical: "bg-rose-50 text-rose-700",
  watch: "bg-amber-50 text-amber-700",
  ok: "bg-emerald-50 text-emerald-700",
};
const RISK_LABEL: Record<RiskLevel, string> = { critical: "Auto-pause risk", watch: "Watch", ok: "On track" };

export default async function NewSipWatchPage() {
  const session = await requireSession();
  if (!session.roles.some((r) => ALLOWED.includes(r))) {
    return (
      <div className="max-w-2xl mx-auto mt-12 card-surface p-8 text-center">
        <AlertTriangle className="size-8 text-amber-600 mx-auto" />
        <h1 className="text-xl font-bold mt-3">Not available for your role</h1>
      </div>
    );
  }

  // RMs see only their own recently-started SIPs; managers/ops see the firm.
  const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "reports.business", session.permissions);
  const { rows, kpis } = await withTenant(session.tenantId, (tx) => computeSipInstallmentWatch(tx, session.tenantId, { rmId: seesAll ? null : session.userId }));

  return (
    <div className="space-y-6 max-w-7xl">
      <Link href="/dashboard/sips" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ArrowLeft className="size-4" /> Back to SIP Tracker
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ShieldAlert className="size-6 text-brand-cyan" /> New-SIP Installment Watch
        </h1>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat icon={Activity} label="New SIPs watched" value={String(kpis.watched)} />
        <Stat icon={ShieldAlert} label="At auto-pause risk" value={String(kpis.atRisk)} tone={kpis.atRisk > 0 ? "rose" : "muted"} />
        <Stat icon={CheckCircle2} label="Passed 6 cleanly" value={String(kpis.passedClean)} tone="emerald" />
      </div>

      <div className="card-surface p-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Legend:</span>
        <Legend cls="bg-emerald-50 text-emerald-700 border-emerald-200" label="Deducted" />
        <Legend cls="bg-rose-50 text-rose-700 border-rose-200" label="Bounced" />
        <Legend cls="bg-amber-50 text-amber-700 border-amber-200" label="Due — no record" />
        <Legend cls="bg-secondary text-muted-foreground border-border" label="Not due yet" />
        <span className="ml-auto">Tap any cell to set/correct it manually (overrides the feed).</span>
      </div>

      <div className="card-surface">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="size-8 mx-auto text-emerald-500/60" />
            <div className="mt-2 font-medium">No new SIPs to watch.</div>
            <p className="mt-2 text-xs max-w-md mx-auto">
              SIPs started in the last 7 months appear here until their first 6 installments are confirmed.
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Client / Scheme</th>
                  <th className="text-right py-2 font-medium">SIP / mo</th>
                  <th className="text-left py-2 font-medium">Started</th>
                  <th className="text-center py-2 font-medium px-4">First 6 installments</th>
                  <th className="text-left py-2 font-medium pr-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.sipId} className="border-b last:border-0 hover:bg-secondary/40 align-top">
                    <td className="px-4 py-3 max-w-[260px]">
                      <Link href={`/dashboard/investors/${r.investorId}`} className="font-medium hover:underline">
                        {r.investorName}
                      </Link>
                      <div className="text-xs text-muted-foreground truncate">{r.schemeName}</div>
                      <div className="text-[11px] text-muted-foreground/80 truncate">
                        {r.amcName}{r.folioNumber ? ` · ${r.folioNumber}` : ""}{r.rmName ? ` · ${r.rmName}` : ""}
                      </div>
                    </td>
                    <td className="py-3 text-right tabular-nums whitespace-nowrap">{formatINR(r.amount)}</td>
                    <td className="py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">{formatDate(r.startISO)}</td>
                    <td className="py-3 px-4">
                      <InstallmentWatchGrid sipId={r.sipId} cells={r.cells} />
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`chip ${RISK_TONE[r.risk]}`}>{RISK_LABEL[r.risk]}</span>
                      <div className="text-[11px] text-muted-foreground mt-1 max-w-[160px]">{r.riskReason}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`size-4 rounded border ${cls}`} /> {label}
    </span>
  );
}

function Stat({ label, value, tone, icon: Icon }: { label: string; value: string; tone?: "rose" | "emerald" | "muted"; icon?: any }) {
  const color = tone === "rose" ? "text-rose-600" : tone === "emerald" ? "text-emerald-600" : "text-foreground";
  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        {Icon && <Icon className="size-3.5 text-muted-foreground" />}
      </div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
