import { sql } from "drizzle-orm";
import { Repeat, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { withTenant } from "@/db/client";
import { formatINR } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";

/**
 * SIP Persistency tile — THE franchise health metric for an MFD.
 *
 * Persistency = % of SIPs that started N months ago and are still active.
 *
 * Industry benchmarks (AMFI research):
 *   - 1-year persistency: 70–75% (top quartile MFDs > 80%)
 *   - 3-year persistency: 55–65% (top quartile > 70%)
 *
 * Also shows:
 *   - SIP book MoM delta (growing / shrinking)
 *   - Top rejection reasons this month (from sip_rejections)
 *
 * Persistency cohort SQL logic:
 *   1-year: SIPs where start_date was 12–15 months ago → % still active
 *   3-year: SIPs where start_date was 36–39 months ago → % still active
 */
export async function SipPersistencyTile({ session }: { session: SessionUser }) {
  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const [persistency, sipBookTrend, rejectionReasons] = await Promise.all([
        // Cohort persistency: started 12-15mo ago (1yr) and 36-39mo ago (3yr)
        await tx.execute(sql`
          SELECT
            -- 1-year cohort
            COUNT(*) FILTER (
              WHERE start_date BETWEEN current_date - interval '15 months'
                                   AND current_date - interval '12 months'
            )::int AS cohort_1y_total,
            COUNT(*) FILTER (
              WHERE start_date BETWEEN current_date - interval '15 months'
                                   AND current_date - interval '12 months'
                AND status = 'active'
            )::int AS cohort_1y_active,

            -- 3-year cohort
            COUNT(*) FILTER (
              WHERE start_date BETWEEN current_date - interval '39 months'
                                   AND current_date - interval '36 months'
            )::int AS cohort_3y_total,
            COUNT(*) FILTER (
              WHERE start_date BETWEEN current_date - interval '39 months'
                                   AND current_date - interval '36 months'
                AND status = 'active'
            )::int AS cohort_3y_active,

            -- Total active SIPs + book
            COUNT(*) FILTER (WHERE status = 'active')::int AS active_count,
            COALESCE(SUM(amount::numeric) FILTER (WHERE status = 'active'), 0)::numeric AS active_book,

            -- New SIPs this month
            COUNT(*) FILTER (
              WHERE created_at >= date_trunc('month', now())
            )::int AS new_mtd,

            -- Stopped/paused this month
            COUNT(*) FILTER (
              WHERE status IN ('stopped','paused','cancelled')
                AND updated_at >= date_trunc('month', now())
            )::int AS stopped_mtd
          FROM sips
        `),

        // SIP book last 3 months for trend
        await tx.execute(sql`
          WITH months AS (
            SELECT generate_series(0, 2) AS ago
          )
          SELECT
            to_char(date_trunc('month', now()) - (ago * interval '1 month'), 'YYYY-MM') AS period,
            COALESCE(SUM(amount::numeric) FILTER (
              WHERE s.status = 'active'
                AND s.created_at <= date_trunc('month', now()) - (ago * interval '1 month') + interval '1 month'
            ), 0)::numeric AS book_snapshot
          FROM months
          CROSS JOIN sips s
          GROUP BY ago
          ORDER BY ago DESC
        `),

        // Top rejection reasons MTD (from sip_rejections table)
        await tx.execute(sql`
          SELECT rejection_reason, COUNT(*)::int AS c
          FROM sip_rejections
          WHERE rejection_date >= date_trunc('month', now())::date
          GROUP BY rejection_reason
          ORDER BY c DESC
          LIMIT 4
        `),
      ]);

      const p = persistency.rows[0] as any;

      const p1yTotal = Number(p.cohort_1y_total ?? 0);
      const p1yActive = Number(p.cohort_1y_active ?? 0);
      const p3yTotal = Number(p.cohort_3y_total ?? 0);
      const p3yActive = Number(p.cohort_3y_active ?? 0);

      const persistency1y = p1yTotal > 0 ? (p1yActive / p1yTotal) * 100 : null;
      const persistency3y = p3yTotal > 0 ? (p3yActive / p3yTotal) * 100 : null;

      const trendRows = sipBookTrend.rows as any[];
      const bookThisMonth = Number(trendRows[2]?.book_snapshot ?? 0);
      const bookLastMonth = Number(trendRows[1]?.book_snapshot ?? 0);
      const bookDelta = bookThisMonth - bookLastMonth;

      return {
        persistency1y,
        persistency3y,
        p1yTotal,
        p3yTotal,
        activeCount: Number(p.active_count ?? 0),
        activeBook: Number(p.active_book ?? 0),
        newMtd: Number(p.new_mtd ?? 0),
        stoppedMtd: Number(p.stopped_mtd ?? 0),
        bookThisMonth,
        bookLastMonth,
        bookDelta,
        rejectionReasons: (rejectionReasons.rows as any[]).map((r) => ({
          reason: String(r.rejection_reason ?? "Unknown").replace(/_/g, " "),
          count: Number(r.c),
        })),
      };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const netSipChange = data.newMtd - data.stoppedMtd;

  function PersistencyGauge({
    label,
    pct,
    benchmark,
    cohortSize,
  }: {
    label: string;
    pct: number | null;
    benchmark: number;
    cohortSize: number;
  }) {
    if (pct === null || cohortSize === 0) {
      return (
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            {label}
          </div>
          <div className="text-xl font-bold text-muted-foreground mt-1">—</div>
          <div className="text-[10px] text-muted-foreground">no cohort yet</div>
        </div>
      );
    }
    const beats = pct >= benchmark;
    const color = beats ? "text-emerald-700" : pct >= benchmark - 10 ? "text-amber-700" : "text-rose-700";
    const bgBar = beats ? "bg-emerald-500" : pct >= benchmark - 10 ? "bg-amber-500" : "bg-rose-500";
    return (
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
          {label}
        </div>
        <div className={`text-2xl font-bold tabular-nums ${color}`}>
          {pct.toFixed(1)}%
        </div>
        <div className="h-1.5 rounded-full bg-secondary overflow-hidden mt-1.5">
          <div
            className={`h-full rounded-full ${bgBar}`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
        <div className="text-[10px] text-muted-foreground mt-1">
          benchmark {benchmark}% · cohort {cohortSize}
        </div>
      </div>
    );
  }

  return (
    <div className="card-surface glass-card p-5 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-violet-50/40 via-transparent to-transparent pointer-events-none" />
      <div className="relative">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
            <div className="size-7 rounded-lg bg-violet-50 grid place-items-center">
              <Repeat className="size-3.5 text-violet-700" />
            </div>
            SIP persistency — franchise health
          </h2>
          <div
            className={`flex items-center gap-1 text-xs font-semibold ${
              netSipChange > 0
                ? "text-emerald-700"
                : netSipChange < 0
                ? "text-rose-700"
                : "text-muted-foreground"
            }`}
          >
            {netSipChange > 0 ? (
              <TrendingUp className="size-3.5" />
            ) : netSipChange < 0 ? (
              <TrendingDown className="size-3.5" />
            ) : (
              <Minus className="size-3.5" />
            )}
            Net {netSipChange >= 0 ? "+" : ""}
            {netSipChange} SIPs MTD
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* 1-year persistency */}
          <div className="p-3 rounded-lg bg-white/70">
            <PersistencyGauge
              label="1-year persistency"
              pct={data.persistency1y}
              benchmark={70}
              cohortSize={data.p1yTotal}
            />
          </div>

          {/* 3-year persistency */}
          <div className="p-3 rounded-lg bg-white/70">
            <PersistencyGauge
              label="3-year persistency"
              pct={data.persistency3y}
              benchmark={60}
              cohortSize={data.p3yTotal}
            />
          </div>

          {/* Book health */}
          <div className="p-3 rounded-lg bg-white/70 space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Active SIP book
            </div>
            <div className="text-xl font-bold tabular-nums">
              {formatINR(data.activeBook)}
              <span className="text-xs font-normal text-muted-foreground">/mo</span>
            </div>
            <div className="text-[10px] text-muted-foreground">
              {data.activeCount.toLocaleString("en-IN")} active SIPs
            </div>
            <div
              className={`text-[10px] font-semibold flex items-center gap-1 ${
                data.bookDelta >= 0 ? "text-emerald-700" : "text-rose-700"
              }`}
            >
              {data.bookDelta >= 0 ? "↑" : "↓"}{" "}
              {formatINR(Math.abs(data.bookDelta))} vs last month
            </div>
          </div>

          {/* MTD SIP flow + rejection reasons */}
          <div className="p-3 rounded-lg bg-white/70">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
              MTD flow
            </div>
            <div className="space-y-1 text-xs mb-3">
              <div className="flex justify-between">
                <span className="text-emerald-700 font-medium">+ New</span>
                <span className="tabular-nums font-bold text-emerald-700">{data.newMtd}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-rose-700 font-medium">− Stopped/Paused</span>
                <span className="tabular-nums font-bold text-rose-700">{data.stoppedMtd}</span>
              </div>
            </div>
            {data.rejectionReasons.length > 0 && (
              <>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                  Top rejection reasons
                </div>
                <ul className="space-y-0.5 text-[10px]">
                  {data.rejectionReasons.slice(0, 3).map((r) => (
                    <li key={r.reason} className="flex justify-between capitalize">
                      <span className="truncate text-muted-foreground">{r.reason}</span>
                      <span className="font-bold text-rose-700 tabular-nums ml-1">{r.count}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>

        <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
          Industry benchmark: 1-year ≥ 70%, 3-year ≥ 60%. Persistency above benchmark = clients
          trust your advice; below = onboarding is ahead of relationship quality.
        </p>
      </div>
    </div>
  );
}
