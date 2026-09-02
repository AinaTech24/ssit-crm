import Link from "next/link";
import {
  TrendingUp,
  IndianRupee,
  AlertTriangle,
  Percent,
  CalendarClock,
  ArrowDownRight,
  Repeat,
  Info,
} from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { computeTrailForecast, type SliceRow } from "@/lib/finance/trail-forecast";
import { TrailProjectionChart } from "@/components/finance/TrailProjectionChart";
import { formatINR } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ALLOWED = ["owner", "branch_head", "compliance"];

/** Compact INR for big AUM numbers: ₹1.24 Cr / ₹4.50 L / ₹12,300. */
function formatCr(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return formatINR(n);
}

export default async function TrailForecastPage() {
  const session = await requireSession();
  if (!session.roles.some((r) => ALLOWED.includes(r))) {
    return (
      <div className="max-w-2xl mx-auto mt-12 card-surface p-8 text-center">
        <AlertTriangle className="size-8 text-amber-600 mx-auto" />
        <h1 className="text-xl font-bold mt-3">Not available for your role</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Trail forecasting is visible to owners, branch heads and compliance.
        </p>
      </div>
    );
  }

  const forecast = await withTenant(
    session.tenantId,
    async (tx) => computeTrailForecast(tx, session.tenantId),
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const f = forecast;
  const hasData = f.totalAum > 0;
  const riskPctOfAnnual =
    f.projectedAnnual > 0 ? (f.atRisk.totalRevenueAtRisk / f.projectedAnnual) * 100 : 0;

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div>
        <h1 className="page-title">
          <TrendingUp className="size-6 text-brand-cyan" /> Trail Forecast &amp; Revenue-at-Risk
        </h1>
      </div>

      {!hasData ? (
        <div className="card-surface p-8 text-center">
          <IndianRupee className="size-8 text-muted-foreground mx-auto" />
          <h2 className="text-lg font-semibold mt-3">No AUM on the book yet</h2>
          <p className="text-muted-foreground text-sm mt-1 max-w-md mx-auto">
            Once folios with AUM are imported (RTA file import or transaction feed), your projected trail
            income and revenue-at-risk will appear here.
          </p>
          <Link href="/dashboard/rta-imports" className="btn-primary mt-4 inline-flex">
            Import RTA file
          </Link>
        </div>
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi
              icon={<IndianRupee className="size-4" />}
              label="Total AUM"
              value={formatCr(f.totalAum)}
              sub="live, open folios"
            />
            <Kpi
              icon={<Percent className="size-4" />}
              label="Blended trail"
              value={`${f.weightedTrailPct.toFixed(2)}%`}
              sub="weighted p.a."
            />
            <Kpi
              icon={<CalendarClock className="size-4" />}
              label="Projected / month"
              value={formatINR(f.projectedMonthly)}
              sub="≈ trail run-rate"
            />
            <Kpi
              icon={<TrendingUp className="size-4" />}
              label="Projected / year"
              value={formatINR(f.projectedAnnual)}
              sub="annualised trail"
              hero
            />
          </div>

          {/* Forward 12-month projection (SIP inflow + market-growth assumption) */}
          <TrailProjectionChart
            baseAum={f.totalAum}
            monthlySipInflow={f.netMonthlySipInflow}
            weightedTrailPct={f.weightedTrailPct}
            staticAnnual={f.projectedAnnual}
          />

          {/* Projected vs actually received (amc_payouts trail, last 12 mo) */}
          <div className="card-surface p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="section-title flex items-center gap-2"><Percent className="size-4 text-brand-cyan" /> Projected vs received</h2>
              {f.received12mo > 0 ? (
                (() => {
                  const gapPct = f.projectedAnnual > 0 ? ((f.projectedAnnual - f.received12mo) / f.projectedAnnual) * 100 : 0;
                  return (
                    <span className={`chip text-[11px] ${gapPct >= 10 ? "bg-rose-50 text-rose-700" : gapPct >= 3 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                      {gapPct >= 0 ? `${gapPct.toFixed(0)}% under-recovery` : `${Math.abs(gapPct).toFixed(0)}% over`}
                    </span>
                  );
                })()
              ) : (
                <span className="chip text-[11px] bg-secondary text-muted-foreground">No payouts recorded</span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Projected / year</div>
                <div className="text-xl font-bold tabular-nums">{formatINR(f.projectedAnnual)}</div>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Received (last 12 mo)</div>
                <div className="text-xl font-bold tabular-nums">{f.received12mo > 0 ? formatINR(f.received12mo) : "—"}</div>
              </div>
              <Link href="/dashboard/commission-reconciliation" className="rounded-lg border border-border bg-card p-3 hover:border-brand-cyan/40 transition-colors">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Gap (potential leak)</div>
                <div className="text-xl font-bold tabular-nums text-rose-700">{f.received12mo > 0 ? formatINR(Math.max(0, f.projectedAnnual - f.received12mo)) : "—"}</div>
                <div className="text-[11px] text-muted-foreground">Reconcile →</div>
              </Link>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">AMC trail under-payment (wrong ARN mapping, missed trail-on-transfer) is a common leak — record payouts in Commission Reconciliation to track recovery.</p>
          </div>

          {/* Revenue at risk */}
          <div className="card-surface p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="section-title flex items-center gap-2">
                <AlertTriangle className="size-4 text-rose-600" /> Revenue at risk
              </h2>
              <span
                className={`chip text-[11px] ${riskPctOfAnnual >= 10
                    ? "bg-rose-50 text-rose-700"
                    : riskPctOfAnnual >= 3
                      ? "bg-amber-50 text-amber-700"
                      : "bg-emerald-50 text-emerald-700"
                  }`}
              >
                {riskPctOfAnnual.toFixed(1)}% of annual trail
              </span>
            </div>

            <div className="grid md:grid-cols-3 gap-3">
              {/* Total */}
              <div className="rounded-xl bg-rose-50/60 border border-rose-100 p-4">
                <div className="text-[10px] uppercase tracking-wider font-semibold text-rose-800">
                  Total trail at risk
                </div>
                <div className="text-2xl font-bold text-rose-800 mt-1 tabular-nums">
                  {formatINR(f.atRisk.totalRevenueAtRisk)}
                </div>
                <div className="text-[11px] text-rose-700/80 mt-0.5">per year, if not saved</div>
              </div>

              {/* Redemption drag */}
              <Link
                href="/dashboard/transactions"
                className="rounded-xl bg-white border border-border p-4 hover:border-rose-200 transition-colors"
              >
                <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground flex items-center gap-1">
                  <ArrowDownRight className="size-3.5" /> Redemption drag (30d)
                </div>
                <div className="text-xl font-bold mt-1 tabular-nums">
                  {formatINR(f.atRisk.redemptionTrailLost)}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {formatCr(f.atRisk.redemptionOutflow30d)} redeemed · {f.atRisk.redemptionCount} txns
                </div>
              </Link>

              {/* At-risk SIPs */}
              <Link
                href="/dashboard/sips"
                className="rounded-xl bg-white border border-border p-4 hover:border-amber-200 transition-colors"
              >
                <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground flex items-center gap-1">
                  <Repeat className="size-3.5" /> At-risk SIP trail
                </div>
                <div className="text-xl font-bold mt-1 tabular-nums">
                  {formatINR(f.atRisk.atRiskSipTrail)}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {f.atRisk.atRiskSipCount} SIPs · {formatINR(f.atRisk.atRiskSipMonthly)}/mo inflow
                </div>
              </Link>
            </div>
            <p className="text-[11px] text-muted-foreground mt-3 flex items-start gap-1.5">
              <Info className="size-3.5 mt-0.5 flex-shrink-0" />
              Redemption drag is the annual trail lost on AUM redeemed in the last 30 days. At-risk SIPs are
              active SIPs with repeated mandate failures, a dead mandate, or ending within 60 days. Saving
              them protects future trail.
            </p>
          </div>

          {/* Actionable at-risk lists — who to save */}
          {(f.atRiskSipList.length > 0 || f.redeemedClients.length > 0) && (
            <div className="grid lg:grid-cols-2 gap-4">
              <div className="card-surface p-5">
                <h2 className="section-title flex items-center gap-2 mb-3"><Repeat className="size-4 text-amber-600" /> At-risk SIPs to save</h2>
                {f.atRiskSipList.length === 0 ? (
                  <p className="text-sm text-muted-foreground">None — your active SIPs look healthy.</p>
                ) : (
                  <div className="divide-y">
                    {f.atRiskSipList.map((s) => (
                      <Link key={s.id} href={s.investorId ? `/dashboard/investors/${s.investorId}` : "/dashboard/sips"} className="flex items-center gap-3 py-2 hover:bg-accent/40 -mx-2 px-2 rounded">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{s.client}</div>
                          <div className="text-[11px] text-amber-700">{s.reason}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-sm tabular-nums">{formatINR(s.monthly)}/mo</div>
                          <div className="text-[11px] text-muted-foreground tabular-nums">{formatINR(s.annual)}/yr</div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
              <div className="card-surface p-5">
                <h2 className="section-title flex items-center gap-2 mb-3"><ArrowDownRight className="size-4 text-rose-600" /> Recent redemptions (30d)</h2>
                {f.redeemedClients.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No redemptions in the last 30 days.</p>
                ) : (
                  <div className="divide-y">
                    {f.redeemedClients.map((c, i) => (
                      <Link key={i} href={c.investorId ? `/dashboard/investors/${c.investorId}` : "/dashboard/transactions"} className="flex items-center gap-3 py-2 hover:bg-accent/40 -mx-2 px-2 rounded">
                        <div className="min-w-0 flex-1 text-sm font-medium truncate">{c.client}</div>
                        <div className="text-right shrink-0">
                          <div className="text-sm tabular-nums">{formatINR(c.amount)}</div>
                          <div className="text-[11px] text-rose-600 tabular-nums">−{formatINR(c.trailLost)}/yr trail</div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Slices */}
          <div className="grid lg:grid-cols-2 gap-4">
            <SliceCard title="Top clients by trail" rows={f.byClient.slice(0, 8)} />
            <SliceCard title="By asset class" rows={f.byCategory} />
            <SliceCard title="By AMC" rows={f.byAmc.slice(0, 8)} />
            <SliceCard title="By relationship manager" rows={f.byRm.slice(0, 8)} />
          </div>

          {/* Methodology note */}
          <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
            <Info className="size-3.5 mt-0.5 flex-shrink-0" />
            Trail rates use your per-AMC negotiated rate from the{" "}
            <Link href="/dashboard/amc-empanelments" className="underline">
              empanelment register
            </Link>{" "}
            where set, otherwise a conservative category fallback (equity 0.85%, hybrid 0.50%, debt 0.30%,
            ELSS 0.95%, liquid 0.08%). Set your real rates per AMC for an exact forecast.
          </p>
        </>
      )}
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
  hero,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  hero?: boolean;
}) {
  return (
    <div className={hero ? "kpi-hero" : "kpi-card"}>
      <div
        className={`text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5 ${hero ? "opacity-90" : "text-muted-foreground"
          }`}
      >
        {icon}
        {label}
      </div>
      <div className="text-2xl font-bold mt-1.5 tabular-nums">{value}</div>
      <div className={`text-[11px] mt-0.5 ${hero ? "opacity-80" : "text-muted-foreground"}`}>{sub}</div>
    </div>
  );
}

function SliceCard({ title, rows }: { title: string; rows: SliceRow[] }) {
  const max = Math.max(...rows.map((r) => r.annualTrail), 1);
  return (
    <div className="card-surface p-4">
      <h3 className="section-title mb-3">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No data.</p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.key}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium truncate pr-2">{r.label}</span>
                <span className="tabular-nums text-muted-foreground flex-shrink-0">
                  {formatINR(r.annualTrail)}
                  <span className="opacity-60"> · {r.sharePct.toFixed(0)}%</span>
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full rounded-full bg-brand-cyan"
                  style={{ width: `${Math.max(2, (r.annualTrail / max) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
