/**
 * Business AUM & Earnings Projections — Network FP "8.4 Business Projections".
 *
 * Server wrapper: seeds the projection inputs from the firm's *real* live book
 * (current AUM + blended commission rate via computeTrailForecast, monthly SIP
 * book from active SIPs) so the owner starts from reality, then hands off to a
 * client component for the interactive what-if math.
 */

import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { computeTrailForecast } from "@/lib/finance/trail-forecast";
import { DEFAULT_PROJECTION_INPUTS, type ProjectionInputs } from "@/lib/finance/projections";
import { currentFyLabel } from "@/lib/finance/fiscal-year";
import { BusinessProjectionsClient } from "@/components/finances/BusinessProjectionsClient";

export const dynamic = "force-dynamic";

/** Normalise a SIP installment to a per-month figure regardless of frequency. */
const FREQ_TO_MONTHLY: Record<string, number> = {
  weekly: 52 / 12,
  fortnightly: 26 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  yearly: 1 / 12,
};

export default async function BusinessProjectionsPage() {
  const session = await requireSession();
  requireCap(session.roles, "reports.commission", session.permissions);

  const live = await withTenant(
    session.tenantId,
    async (tx) => {
      const [forecast, sipRows] = await Promise.all([
        computeTrailForecast(tx, session.tenantId).catch(() => null),
        tx.execute(sql`
          SELECT COALESCE(frequency,'monthly') AS frequency, COALESCE(SUM(amount::numeric),0) AS amt
          FROM sips WHERE status = 'active' GROUP BY frequency
        `),
      ]);
      let monthlySipBook = 0;
      for (const r of sipRows.rows as any[]) {
        const f = String(r.frequency || "monthly");
        monthlySipBook += Number(r.amt) * (FREQ_TO_MONTHLY[f] ?? 1);
      }
      return {
        existingAum: forecast ? Number(forecast.totalAum) : 0,
        commissionRatePct: forecast && forecast.weightedTrailPct > 0 ? Number(forecast.weightedTrailPct) : 0,
        existingSipBook: monthlySipBook,
        annualSipInflow: forecast ? Number(forecast.netMonthlySipInflow) * 12 : 0,
      };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  // We have real data if the book actually has AUM. Otherwise fall back to the
  // illustrative example so the page is never empty.
  const seeded = live.existingAum > 0;
  const seed: ProjectionInputs = seeded
    ? {
        ...DEFAULT_PROJECTION_INPUTS,
        existingAum: Math.round(live.existingAum),
        existingSipBook: Math.round(live.existingSipBook),
        newSipPerYear: Math.round(live.annualSipInflow || live.existingSipBook * 12 * 0.2),
        commissionRatePct: live.commissionRatePct > 0 ? Number(live.commissionRatePct.toFixed(2)) : DEFAULT_PROJECTION_INPUTS.commissionRatePct,
        startFyLabel: currentFyLabel(),
      }
    : { ...DEFAULT_PROJECTION_INPUTS, startFyLabel: currentFyLabel() };

  return <BusinessProjectionsClient seed={seed} seeded={seeded} />;
}
