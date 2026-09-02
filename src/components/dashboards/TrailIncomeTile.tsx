import Link from "next/link";
import { sql } from "drizzle-orm";
import { IndianRupee, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2 } from "lucide-react";
import { withTenant } from "@/db/client";
import { formatINR } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Trail Income tile — surfaces the single most important MFD business metric
 * that was previously invisible on the dashboard.
 *
 * Data sources:
 *   - amc_payouts  → actual received amounts (parsed CAMS/KFin statements)
 *   - commission_records → expected vs received per period, anomalies
 *
 * Gracefully degrades to "Import brokerage statement to see trail income"
 * when no data exists — so the tile is safe to add even before reconciliation
 * is wired up.
 *
 * Shows:
 *   - Trail received this month (net of TDS)
 *   - Trail expected this month (from commission_records)
 *   - Collection efficiency % (received / expected)
 *   - Anomaly count (variance > 2%) with link to commission-reconciliation
 *   - 3-month trend (received amounts last 3 periods)
 */
export async function TrailIncomeTile({ session }: { session: SessionUser }) {
  const now = new Date();
  // Indian financial year starts April
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Last 3 periods for sparkline
  const periods: string[] = [];
  for (let i = 2; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    periods.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const [payoutSummary, commissionSummary, trend] = await Promise.all([
        // Current period payout totals from amc_payouts
        await tx.execute(sql`
          SELECT
            COALESCE(SUM(gross_amount::numeric), 0)::numeric AS gross_received,
            COALESCE(SUM(tds_amount::numeric), 0)::numeric AS tds_deducted,
            COALESCE(SUM(net_amount::numeric), 0)::numeric AS net_received,
            COUNT(DISTINCT amc_code)::int AS amc_count,
            COUNT(*)::int AS payout_lines
          FROM amc_payouts
          WHERE period = ${currentPeriod}
        `),

        // Expected vs received from commission_records
        await tx.execute(sql`
          SELECT
            COALESCE(SUM(expected_amount::numeric), 0)::numeric AS total_expected,
            COALESCE(SUM(received_amount::numeric), 0)::numeric AS total_received,
            COUNT(*) FILTER (WHERE status = 'anomaly')::int AS anomaly_count,
            COUNT(*) FILTER (WHERE status = 'matched')::int AS matched_count,
            COUNT(*)::int AS total_records
          FROM commission_records
          WHERE period = ${currentPeriod}
        `),

        // 3-month received trend
        await tx.execute(sql`
          SELECT period,
            COALESCE(SUM(net_amount::numeric), 0)::numeric AS net_received
          FROM amc_payouts
          WHERE period IN (${sql.join(periods.map((p) => sql`${p}`), sql`, `)})
          GROUP BY period
          ORDER BY period ASC
        `),
      ]);

      const p = payoutSummary.rows[0] as any;
      const c = commissionSummary.rows[0] as any;

      const netReceived = Number(p.net_received ?? 0);
      const totalExpected = Number(c.total_expected ?? 0);
      const efficiency =
        totalExpected > 0 ? (netReceived / totalExpected) * 100 : null;

      const trendByPeriod = Object.fromEntries(
        (trend.rows as any[]).map((r) => [r.period, Number(r.net_received ?? 0)])
      );
      const trendValues = periods.map((p) => trendByPeriod[p] ?? 0);
      const prevMonth = trendValues[1] ?? 0;
      const trendDelta = netReceived - prevMonth;

      const hasData = Number(p.payout_lines ?? 0) > 0 || Number(c.total_records ?? 0) > 0;

      return {
        netReceived,
        grossReceived: Number(p.gross_received ?? 0),
        tdsDeducted: Number(p.tds_deducted ?? 0),
        totalExpected,
        efficiency,
        anomalyCount: Number(c.anomaly_count ?? 0),
        matchedCount: Number(c.matched_count ?? 0),
        amcCount: Number(p.amc_count ?? 0),
        trendValues,
        trendDelta,
        prevMonth,
        hasData,
        currentPeriod,
      };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  // No data yet — show import prompt
  if (!data.hasData) {
    return (
      <div className="card-surface glass-card p-5 border-dashed border-2 border-border/50">
        <div className="flex items-start gap-3">
          <div className="size-10 rounded-lg bg-amber-50 grid place-items-center flex-shrink-0">
            <IndianRupee className="size-5 text-amber-700" />
          </div>
          <div>
            <div className="font-semibold text-sm">Trail income not yet visible</div>
            <div className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Import your CAMS or KFintech brokerage statement to see trail received vs expected,
              collection efficiency, and anomaly detection.
            </div>
            <Link
              href="/dashboard/commission-reconciliation"
              className="inline-flex items-center gap-1 mt-2 text-xs text-amber-700 font-semibold hover:underline"
            >
              Go to Commission Reconciliation →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const trendUp = data.trendDelta >= 0;

  return (
    <div className="card-surface glass-card p-5 relative overflow-hidden">
      {/* Subtle gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/60 via-transparent to-transparent pointer-events-none" />
      <div className="relative">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
            <div className="size-7 rounded-lg bg-emerald-50 grid place-items-center">
              <IndianRupee className="size-3.5 text-emerald-700" />
            </div>
            Trail income — {data.currentPeriod}
          </h2>
          <Link
            href="/dashboard/commission-reconciliation"
            className="text-xs text-emerald-700 hover:underline font-semibold"
          >
            Full reconciliation →
          </Link>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Net received (hero) */}
          <div className="md:col-span-1 bg-emerald-50/60 border border-emerald-100 rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wider text-emerald-800 font-semibold">
              Net received
            </div>
            <div className="text-2xl font-bold text-emerald-800 mt-1 tabular-nums">
              {formatINR(data.netReceived)}
            </div>
            <div className="text-[10px] text-emerald-700/80 mt-0.5">
              TDS deducted: {formatINR(data.tdsDeducted)}
            </div>
          </div>

          {/* Expected */}
          <div className="bg-white/70 rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Expected
            </div>
            <div className="text-xl font-bold mt-1 tabular-nums">
              {formatINR(data.totalExpected)}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              from commission records
            </div>
          </div>

          {/* Collection efficiency */}
          <div className="bg-white/70 rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Collection %
            </div>
            <div
              className={`text-xl font-bold mt-1 tabular-nums ${
                data.efficiency == null
                  ? "text-muted-foreground"
                  : data.efficiency >= 95
                  ? "text-emerald-700"
                  : data.efficiency >= 85
                  ? "text-amber-700"
                  : "text-rose-700"
              }`}
            >
              {data.efficiency != null ? `${data.efficiency.toFixed(1)}%` : "—"}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {data.amcCount} AMC{data.amcCount === 1 ? "" : "s"}
            </div>
          </div>

          {/* Anomalies */}
          <div
            className={`rounded-lg p-3 ${
              data.anomalyCount > 0
                ? "bg-rose-50/60 border border-rose-100"
                : "bg-white/70"
            }`}
          >
            <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
              Anomalies
            </div>
            <div
              className={`text-xl font-bold mt-1 tabular-nums flex items-center gap-1.5 ${
                data.anomalyCount > 0 ? "text-rose-700" : "text-emerald-700"
              }`}
            >
              {data.anomalyCount > 0 ? (
                <AlertTriangle className="size-4" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              {data.anomalyCount}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {data.anomalyCount > 0 ? "need investigation" : "all matched"}
            </div>
          </div>
        </div>

        {/* 3-month sparkline bars + MoM delta */}
        <div className="mt-4 flex items-end justify-between">
          <div className="flex items-end gap-2">
            <span className="text-[10px] text-muted-foreground font-medium">3-month:</span>
            {data.trendValues.map((v, i) => {
              const max = Math.max(...data.trendValues, 1);
              const h = Math.round((v / max) * 32);
              return (
                <div
                  key={i}
                  className={`w-8 rounded-t ${
                    i === 2 ? "bg-emerald-500" : "bg-emerald-200"
                  }`}
                  style={{ height: `${Math.max(4, h)}px` }}
                  title={`${periods[i]}: ${formatINR(v)}`}
                />
              );
            })}
            <span className="text-xs text-muted-foreground tabular-nums ml-1">
              {data.trendValues.map((v) => formatINR(v)).join(" → ")}
            </span>
          </div>
          <div
            className={`flex items-center gap-1 text-xs font-semibold ${
              trendUp ? "text-emerald-700" : "text-rose-700"
            }`}
          >
            {trendUp ? (
              <TrendingUp className="size-3.5" />
            ) : (
              <TrendingDown className="size-3.5" />
            )}
            {trendUp ? "+" : ""}
            {formatINR(Math.abs(data.trendDelta))} vs last month
          </div>
        </div>
      </div>
    </div>
  );
}
