/**
 * Sub-distributor commission payouts.
 *
 * Runs after the firm-level reconcilePeriod() to compute what's owed
 * to each channel partner who sourced business. Logic:
 *
 *   1. For each active sub-distributor with a commission_split_pct,
 *      find investors who came via a lead with sub_distributor_id = X
 *      (lead → leads.converted_investor_id chain).
 *   2. Sum those investors' total AUM (or AUM per AMC/scheme if we want
 *      to be exact; AUM total is fine for MVP — the firm-level trail
 *      already prices accurately, we're just splitting it).
 *   3. Compute the firm's trail on that AUM × the sub-distributor's
 *      share %. Result is what the firm owes them this period.
 *
 * Read-only computation — does NOT write to DB. Caller (the UI page or
 * a future "post payouts" action) decides whether to persist.
 *
 * Why no separate sub_distributor_payouts table yet: the firm-level
 * commission_records already lock the period numbers. The sub-distributor
 * split is a derived view — computing on-the-fly each time is cheap
 * (small number of sub-distributors per tenant) and avoids data drift
 * if commission_records get re-reconciled.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

/**
 * Average trail rate across the tenant for the period. Used as a single
 * blended number to multiply by partner-attributed AUM. We don't break
 * out per scheme here because the partner's split is fixed; what matters
 * is the total they're owed. If granular per-scheme attribution becomes
 * a real ask, switch to a join through transactions.
 *
 * Falls back to the firm-level default (0.65% p.a.) when there's no
 * commission_records data yet for the period.
 */
async function blendedTrailRatePct(
  tx: Tx,
  tenantId: string,
  period: string
): Promise<number> {
  const r = await tx.execute(sql`
    SELECT SUM(expected_amount) AS expected, SUM(trail_rate_pct * expected_amount) / NULLIF(SUM(expected_amount), 0) AS weighted_rate
    FROM commission_records
    WHERE tenant_id = ${tenantId} AND period = ${period}
  `);
  const row = (r.rows[0] ?? {}) as { weighted_rate?: string | number | null };
  const rate = row.weighted_rate != null ? Number(row.weighted_rate) : NaN;
  return Number.isFinite(rate) && rate > 0 ? rate : 0.65;
}

export type SubDistributorPayout = {
  subDistributorId: string;
  name: string;
  code: string | null;
  arnNumber: string | null;
  commissionSplitPct: number;
  attributedInvestorCount: number;
  attributedAum: number;
  estimatedMonthlyTrail: number;
  estimatedPartnerShare: number;
  bankDetails: any | null;
  status: string;
};

/**
 * Compute what's owed to each sub-distributor for the given period.
 * `period` is YYYY-MM (matches commission_records.period).
 */
export async function computeSubDistributorPayouts(
  tx: Tx,
  tenantId: string,
  period: string
): Promise<SubDistributorPayout[]> {
  // Single SQL — aggregate AUM per sub-distributor via the
  // leads → converted_investor chain. Active sub-dists only; only those
  // with a non-null commission_split_pct (others aren't on a split).
  const rows = await tx.execute(sql`
    SELECT
      sd.id AS sub_distributor_id,
      sd.name,
      sd.code,
      sd.arn_number,
      sd.commission_split_pct,
      sd.bank_details,
      sd.status,
      COUNT(DISTINCT i.id) FILTER (WHERE i.id IS NOT NULL) AS investor_count,
      COALESCE(SUM(i.aum::numeric) FILTER (WHERE i.status = 'active'), 0) AS attributed_aum
    FROM sub_distributors sd
    LEFT JOIN leads l
      ON l.sub_distributor_id = sd.id
     AND l.converted_investor_id IS NOT NULL
    LEFT JOIN investors i
      ON i.id = l.converted_investor_id
    WHERE sd.tenant_id = ${tenantId}
      AND sd.status = 'active'
      AND sd.commission_split_pct IS NOT NULL
    GROUP BY sd.id, sd.name, sd.code, sd.arn_number,
             sd.commission_split_pct, sd.bank_details, sd.status
    ORDER BY sd.name
  `);

  const blendedRatePctPa = await blendedTrailRatePct(tx, tenantId, period);
  // Convert per-annum to monthly.
  const monthlyRateFraction = blendedRatePctPa / 100 / 12;

  return (rows.rows as Array<any>).map((r) => {
    const aum = Number(r.attributed_aum ?? 0);
    const splitPct = Number(r.commission_split_pct ?? 0);
    const monthlyTrail = aum * monthlyRateFraction;
    const partnerShare = monthlyTrail * (splitPct / 100);
    return {
      subDistributorId: r.sub_distributor_id,
      name: r.name,
      code: r.code,
      arnNumber: r.arn_number,
      commissionSplitPct: splitPct,
      attributedInvestorCount: Number(r.investor_count ?? 0),
      attributedAum: aum,
      estimatedMonthlyTrail: monthlyTrail,
      estimatedPartnerShare: partnerShare,
      bankDetails: r.bank_details,
      status: r.status,
    };
  });
}
