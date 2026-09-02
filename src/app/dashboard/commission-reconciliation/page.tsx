import Link from "next/link";
import { Fragment } from "react";
import { sql } from "drizzle-orm";
import { Coins, AlertTriangle, TrendingDown, TrendingUp, HeartHandshake } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { formatINR } from "@/lib/utils";
import { ReconcileButton } from "@/components/commission/ReconcileButton";
import { PayoutImport } from "@/components/commission/PayoutImport";
import { PeriodPicker } from "@/components/commission/PeriodPicker";
import { computeSubDistributorPayouts } from "@/lib/commission/sub_distributor_payouts";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-50 text-gray-700",
  matched: "bg-emerald-50 text-emerald-700",
  anomaly: "bg-rose-50 text-rose-700",
  investigating: "bg-amber-50 text-amber-700",
  resolved: "bg-emerald-50 text-emerald-700",
  written_off: "bg-slate-50 text-slate-700",
};

export const dynamic = "force-dynamic";

export default async function CommissionReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const now = new Date();
  const defaultPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const period = sp.period ?? defaultPeriod;

  const data = await withTenant(session.tenantId, async (tx) => {
    const rows = await tx.execute(sql`
      SELECT * FROM commission_records
      WHERE period = ${period}
      ORDER BY ABS(variance::numeric) DESC LIMIT 200
    `);

    const stats = await tx.execute(sql`
      SELECT
        COALESCE(SUM(expected_amount::numeric), 0) AS total_expected,
        COALESCE(SUM(received_amount::numeric), 0) AS total_received,
        COALESCE(SUM(variance::numeric), 0) AS total_variance,
        -- Recoverable shortfall: money we should have received but didn't.
        COALESCE(SUM(GREATEST(expected_amount::numeric - received_amount::numeric, 0)), 0) AS shortfall,
        -- Unexplained surplus: received > expected (almost always a data gap).
        COALESCE(SUM(GREATEST(received_amount::numeric - expected_amount::numeric, 0)), 0) AS surplus,
        COUNT(*) FILTER (WHERE status = 'anomaly')::int AS anomalies,
        COUNT(*)::int AS total_lines
      FROM commission_records WHERE period = ${period}
    `);

    // Rate-accuracy: how many AMCs in this period use a negotiated trail rate
    // (empanelment override) vs the conservative category fallback.
    const rateAccuracy = await tx.execute(sql`
      WITH amcs AS (SELECT DISTINCT amc_code FROM commission_records WHERE period = ${period} AND amc_code IS NOT NULL)
      SELECT
        (SELECT COUNT(*)::int FROM amcs) AS total_amcs,
        (SELECT COUNT(*)::int FROM amcs a
          JOIN amc_empanelments e ON e.amc_code = a.amc_code AND e.tenant_id = ${session.tenantId}
          WHERE e.status = 'empanelled' AND e.trail_rate_override_pct IS NOT NULL) AS rated_amcs
    `);

    const ytd = await tx.execute(sql`
      SELECT
        COALESCE(SUM(expected_amount::numeric), 0) AS expected_ytd,
        COALESCE(SUM(received_amount::numeric), 0) AS received_ytd,
        COALESCE(SUM(variance::numeric), 0) AS variance_ytd,
        COALESCE(SUM(GREATEST(expected_amount::numeric - received_amount::numeric, 0)), 0) AS shortfall_ytd
      FROM commission_records
      WHERE period >= ${`${now.getFullYear()}-04`}
    `);

    const availablePeriods = await tx.execute(sql`
      SELECT DISTINCT period FROM commission_records ORDER BY period DESC LIMIT 24
    `);

    // Sub-distributor payouts due for the same period.
    const subDistPayouts = await computeSubDistributorPayouts(
      tx,
      session.tenantId,
      period
    );

    return {
      rows: rows.rows as any[],
      stats: stats.rows[0] as any,
      ytd: ytd.rows[0] as any,
      rateAccuracy: rateAccuracy.rows[0] as any,
      availablePeriods: (availablePeriods.rows as any[]).map((r) => r.period),
      subDistPayouts,
    };
  });

  const totalExpected = Number(data.stats.total_expected ?? 0);
  const totalReceived = Number(data.stats.total_received ?? 0);
  const shortfall = Number(data.stats.shortfall ?? 0);
  const surplus = Number(data.stats.surplus ?? 0);
  const totalAmcs = Number(data.rateAccuracy?.total_amcs ?? 0);
  const ratedAmcs = Number(data.rateAccuracy?.rated_amcs ?? 0);
  // Received ≫ expected almost always means the expected base (folio AUM / trail
  // rates) is incomplete, not a windfall — surface it instead of painting green.
  const dataGap = totalExpected > 0 && totalReceived > totalExpected * 3;

  // Per-AMC rollup — group the scheme lines under their AMC with subtotals, so
  // you read concentration of leakage at the AMC level before drilling in.
  const amcGroups = (() => {
    const m = new Map<string, { amc: string; rows: any[]; expected: number; received: number; shortfall: number; anomalies: number }>();
    for (const r of data.rows) {
      const amc = r.amc_code ?? "—";
      let g = m.get(amc);
      if (!g) { g = { amc, rows: [], expected: 0, received: 0, shortfall: 0, anomalies: 0 }; m.set(amc, g); }
      g.rows.push(r);
      g.expected += Number(r.expected_amount ?? 0);
      g.received += Number(r.received_amount ?? 0);
      g.shortfall += Math.max(Number(r.expected_amount ?? 0) - Number(r.received_amount ?? 0), 0);
      if (r.status === "anomaly") g.anomalies++;
    }
    return [...m.values()].sort((a, b) => b.shortfall - a.shortfall || Math.abs(b.received - b.expected) - Math.abs(a.received - a.expected));
  })();

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Coins className="size-6" /> Brokerage reconciliation
          </h1>
          <p className="text-muted-foreground text-sm max-w-2xl">
            Compare what AMCs paid vs what your folios should have earned, scheme by scheme. Trail leakage from
            wrong-ARN-mapping and missed installments routinely costs 1–2% of regular AUM — easy money to recover.
          </p>
        </div>
        <ReconcileButton period={period} />
      </div>

      <PeriodPicker period={period} options={data.availablePeriods} />

      <PayoutImport period={period} />

      {/* Data-confidence banner — when received ≫ expected, the expected base is
          almost certainly incomplete (empty/partial folio book or fallback rates). */}
      {dataGap && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 text-sm flex items-start gap-2">
          <AlertTriangle className="size-4 mt-0.5 shrink-0 text-amber-600" />
          <div>
            <strong>Expected looks under-computed.</strong> Expected ({formatINR(totalExpected)}) is calculated from your folio
            AUM, but you received {formatINR(totalReceived)} — implying a much larger book. Import your full holdings
            (RTA/CAS) and set per-AMC trail rates before trusting the variance below; the big &ldquo;surplus&rdquo; is most
            likely a data gap, not a windfall.
          </div>
        </div>
      )}

      {/* Rate-accuracy nudge — expected is only as good as the trail rates. */}
      {totalAmcs > 0 && ratedAmcs < totalAmcs && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 text-blue-900 px-4 py-2.5 text-xs flex items-center gap-2">
          <TrendingUp className="size-3.5 shrink-0" />
          Using <strong>conservative fallback</strong> trail rates for {totalAmcs - ratedAmcs} of {totalAmcs} AMCs.{" "}
          <Link href="/dashboard/amc-empanelments" className="underline font-medium">Set negotiated rates</Link> for accurate &ldquo;expected&rdquo;.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Expected" value={formatINR(totalExpected)} icon={TrendingUp} />
        <Kpi label="Received" value={formatINR(totalReceived)} />
        <Kpi
          label="Recoverable shortfall"
          value={formatINR(shortfall)}
          tone={shortfall > 0 ? "rose" : "muted"}
          icon={TrendingDown}
        />
        <Kpi label="Anomalies" value={String(data.stats.anomalies)} tone={data.stats.anomalies > 0 ? "rose" : "muted"} icon={AlertTriangle} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          label="Unexplained surplus"
          value={formatINR(surplus)}
          tone={dataGap ? "amber" : "muted"}
          sub={dataGap ? "likely incomplete data" : surplus > 0 ? "received > expected" : undefined}
        />
        <Kpi label="YTD expected" value={formatINR(Number(data.ytd.expected_ytd))} />
        <Kpi label="YTD received" value={formatINR(Number(data.ytd.received_ytd))} />
        <Kpi
          label="YTD recoverable"
          value={formatINR(Number(data.ytd.shortfall_ytd))}
          tone={Number(data.ytd.shortfall_ytd) > 0 ? "rose" : "muted"}
        />
      </div>

      <div className="border rounded-lg bg-card">
        <div className="border-b px-4 py-2.5 font-medium">
          Scheme-wise lines · {period}
        </div>
        {data.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No reconciliation data for this period yet. Click <strong>Recompute reconciliation</strong> above to
            generate it from existing folio + payout data.
          </div>
        ) : (
          <div className="table-scroll">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
              <tr>
                <th className="text-left px-4 py-2 font-medium">AMC</th>
                <th className="text-left py-2 font-medium">Scheme</th>
                <th className="text-right py-2 font-medium">Expected</th>
                <th className="text-right py-2 font-medium">Received</th>
                <th className="text-right py-2 font-medium">Variance</th>
                <th className="text-right py-2 font-medium">Variance %</th>
                <th className="text-left py-2 font-medium pl-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {amcGroups.map((g) => {
                const gv = g.received - g.expected;
                return (
                  <Fragment key={g.amc}>
                    {/* AMC subtotal header */}
                    <tr className="bg-secondary/40 border-b">
                      <td className="px-4 py-2 font-mono text-xs font-semibold" colSpan={2}>
                        {g.amc}
                        <span className="ml-2 text-[10px] text-muted-foreground font-sans">{g.rows.length} scheme{g.rows.length !== 1 ? "s" : ""}{g.anomalies > 0 ? ` · ${g.anomalies} anomaly` : ""}</span>
                      </td>
                      <td className="py-2 text-right tabular-nums text-xs font-semibold">{formatINR(g.expected)}</td>
                      <td className="py-2 text-right tabular-nums text-xs font-semibold">{formatINR(g.received)}</td>
                      <td className={`py-2 text-right tabular-nums text-xs font-semibold ${gv < 0 ? "text-rose-600" : gv > 0 ? "text-amber-600" : ""}`}>
                        {gv >= 0 ? "+" : ""}{formatINR(gv)}
                      </td>
                      <td colSpan={2} className="py-2 pl-3 text-[10px] text-muted-foreground">
                        {g.shortfall > 0 ? `${formatINR(g.shortfall)} recoverable` : ""}
                      </td>
                    </tr>
                    {g.rows.map((r) => {
                      const v = Number(r.variance);
                      const vPct = Number(r.variance_pct) * 100;
                      return (
                        <tr key={r.id} className="border-b last:border-0 hover:bg-accent/40">
                          <td className="px-4 py-3"></td>
                          <td className="py-3">
                            <div className="text-sm">{r.scheme_name ?? "—"}</div>
                            <div className="text-xs text-muted-foreground font-mono">{r.scheme_code || "(no scheme code)"}</div>
                          </td>
                          <td className="py-3 text-right tabular-nums">{formatINR(Number(r.expected_amount))}</td>
                          <td className="py-3 text-right tabular-nums">{formatINR(Number(r.received_amount))}</td>
                          <td className={`py-3 text-right tabular-nums ${v < 0 ? "text-rose-600" : v > 0 ? "text-amber-600" : ""}`} title={v < 0 ? "Shortfall — recoverable" : v > 0 ? "Surplus — check data/mapping" : ""}>
                            {v >= 0 ? "+" : ""}{formatINR(v)}
                          </td>
                          <td className="py-3 text-right tabular-nums text-xs">
                            {Math.abs(vPct) > 0.01 ? `${vPct >= 0 ? "+" : ""}${vPct.toFixed(1)}%` : "—"}
                          </td>
                          <td className="py-3 pl-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[r.status] ?? ""}`}>
                              {r.status.replace(/_/g, " ")}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* Sub-distributor payouts due (period) */}
      {data.subDistPayouts.length > 0 && (
        <div className="card-surface p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-base flex items-center gap-2">
                <HeartHandshake className="size-4 text-violet-600" />
                Sub-distributor payouts due — {period}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Computed from this period's blended trail rate × each
                partner's attributed AUM × their commission split %.
                Estimate — confirm with the AMC payout before disbursing.
              </p>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Total payable
              </div>
              <div className="text-lg font-semibold text-violet-700">
                {formatINR(
                  data.subDistPayouts.reduce(
                    (s, r) => s + r.estimatedPartnerShare,
                    0
                  )
                )}
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[860px]">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">Partner</th>
                  <th className="px-3 py-2 text-left">ARN</th>
                  <th className="px-3 py-2 text-right">Clients</th>
                  <th className="px-3 py-2 text-right">Attributed AUM</th>
                  <th className="px-3 py-2 text-right">Split %</th>
                  <th className="px-3 py-2 text-right">Est. monthly trail</th>
                  <th className="px-3 py-2 text-right">Partner share</th>
                </tr>
              </thead>
              <tbody>
                {data.subDistPayouts.map((p) => (
                  <tr key={p.subDistributorId} className="border-t">
                    <td className="px-3 py-2">
                      <Link
                        href={`/dashboard/sub-distributors/${p.subDistributorId}`}
                        className="font-medium hover:underline"
                      >
                        {p.name}
                      </Link>
                      {p.code && (
                        <div className="text-[10px] text-muted-foreground font-mono">
                          {p.code}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {p.arnNumber ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {p.attributedInvestorCount}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatINR(p.attributedAum)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {p.commissionSplitPct.toFixed(2)}%
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {formatINR(p.estimatedMonthlyTrail)}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-violet-700">
                      {formatINR(p.estimatedPartnerShare)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="border rounded-lg bg-blue-50 border-blue-200 p-4 text-sm text-blue-900">
        <strong>How it works:</strong> The reconciler pulls payouts from CAMS / KFintech distributor feeds
        (configured under Settings → Integrations) and computes expected trail per scheme using
        empanelment rates × average folio AUM. Variance &gt; 2% is flagged as an anomaly — chase the AMC, fix
        the ARN mapping, or write off. YTD leakage is the headline number that justifies this SaaS by itself.
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  icon: Icon,
  tone,
  sub,
}: {
  label: string;
  value: string;
  icon?: any;
  tone?: "rose" | "emerald" | "amber" | "muted";
  sub?: string;
}) {
  const color = tone === "rose" ? "text-rose-600" : tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : "text-foreground";
  return (
    <div className="border rounded-lg p-5 bg-card">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        {Icon && <Icon className="size-3.5" />}
      </div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
