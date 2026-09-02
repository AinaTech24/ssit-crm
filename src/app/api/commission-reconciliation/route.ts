/**
 * GET /api/commission-reconciliation[?period=YYYY-MM] — JSON feed for the mobile
 * Commission Reconciliation screen. Mirrors the web
 * /dashboard/commission-reconciliation RSC: period stats (expected / received /
 * shortfall / surplus / anomalies), YTD roll-up, rate-accuracy, scheme lines,
 * and sub-distributor payouts due (computeSubDistributorPayouts — the same
 * helper the page uses). Read-only; the reconcile action stays on POST
 * /api/commission/reconcile.
 */

import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { computeSubDistributorPayouts } from "@/lib/commission/sub_distributor_payouts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["reports.commission", "dashboard.view.owner"], session.permissions);

    const now = new Date();
    const defaultPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const period = req.nextUrl.searchParams.get("period") || defaultPeriod;

    const data = await withTenant(
      session.tenantId,
      async (tx) => {
        const rows = await tx.execute(sql`
          SELECT * FROM commission_records WHERE period = ${period}
          ORDER BY ABS(variance::numeric) DESC LIMIT 200
        `);
        const stats = await tx.execute(sql`
          SELECT
            COALESCE(SUM(expected_amount::numeric), 0) AS total_expected,
            COALESCE(SUM(received_amount::numeric), 0) AS total_received,
            COALESCE(SUM(variance::numeric), 0) AS total_variance,
            COALESCE(SUM(GREATEST(expected_amount::numeric - received_amount::numeric, 0)), 0) AS shortfall,
            COALESCE(SUM(GREATEST(received_amount::numeric - expected_amount::numeric, 0)), 0) AS surplus,
            COUNT(*) FILTER (WHERE status = 'anomaly')::int AS anomalies,
            COUNT(*)::int AS total_lines
          FROM commission_records WHERE period = ${period}
        `);
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
          FROM commission_records WHERE period >= ${`${now.getFullYear()}-04`}
        `);
        const availablePeriods = await tx.execute(sql`
          SELECT DISTINCT period FROM commission_records ORDER BY period DESC LIMIT 24
        `);
        const subDistPayouts = await computeSubDistributorPayouts(tx as any, session.tenantId, period);

        return {
          rows: rows.rows as any[],
          stats: (stats.rows[0] ?? {}) as any,
          ytd: (ytd.rows[0] ?? {}) as any,
          rateAccuracy: (rateAccuracy.rows[0] ?? {}) as any,
          availablePeriods: (availablePeriods.rows as any[]).map((r) => r.period),
          subDistPayouts,
        };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    return NextResponse.json({ period, ...data });
  } catch (err) {
    return handleApiError(err);
  }
}
