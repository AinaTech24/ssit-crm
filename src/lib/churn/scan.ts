/**
 * Batch churn scan — computes the churn-risk signals for every active/dormant
 * client in ONE aggregate query, then scores them with the scorecard. Powers
 * the /dashboard/reports/churn-risk page.
 *
 * XIRR is omitted from the batch (it needs a per-investor NAV join — too heavy
 * for a whole-book sweep); the per-investor badge on the 360 page adds it. The
 * other behavioural signals (redemptions, net flow, SIP health, dormancy,
 * silence) carry the batch score well.
 *
 * Tenant scoping is the caller's (pass the tx from withTenant — RLS scopes the
 * rows).
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { churnScore, type ChurnResult, type ChurnSignals } from "./score";

/**
 * Churn-risk for ONE investor (the 360-page badge). Computes the same
 * behavioural signals as the batch scan for a single client, and lets the
 * caller pass the precise XIRR (the 360 page already computes valuation, so we
 * fold in the real return — which the batch sweep skips for cost).
 */
export async function churnForInvestor(
  tx: Tx,
  investorId: string,
  xirr: number | null
): Promise<ChurnResult> {
  const res = await tx.execute(sql`
    SELECT
      i.status, i.service_tier, i.onboarded_at, i.last_contact_at,
      i.redemption_risk_flagged_at, COALESCE(i.aum, 0)::numeric AS aum,
      COUNT(t.id) FILTER (WHERE t.direction = 'outflow' AND t.order_date > CURRENT_DATE - 180) AS red_count_180d,
      COALESCE(SUM(t.amount::numeric) FILTER (WHERE t.direction = 'outflow' AND t.order_date > CURRENT_DATE - 180), 0) AS red_amt_180d,
      COALESCE(SUM(CASE WHEN t.direction = 'inflow' THEN t.amount::numeric ELSE -t.amount::numeric END)
               FILTER (WHERE t.order_date > CURRENT_DATE - 365), 0) AS net_flow_365d,
      MAX(t.order_date) FILTER (WHERE t.direction = 'inflow') AS last_inflow_at,
      (SELECT COUNT(*) FROM sips s WHERE s.investor_id = i.id AND s.status = 'active') AS active_sips,
      (SELECT COUNT(*) FROM sips s WHERE s.investor_id = i.id AND s.status = 'stopped' AND s.updated_at > now() - interval '90 days') AS sip_stops_90d,
      (SELECT COUNT(*) FROM sip_rejections r WHERE r.investor_id = i.id AND r.rejection_date > CURRENT_DATE - 90) AS sip_rej_90d
    FROM investors i
    LEFT JOIN transactions t ON t.investor_id = i.id AND t.status IN ('processed', 'successful')
    WHERE i.id = ${investorId}
    GROUP BY i.id
  `);
  const r = (res.rows as any[])[0];
  if (!r) return churnScore({});
  const signals: ChurnSignals = {
    status: r.status,
    serviceTier: r.service_tier,
    onboardedAt: r.onboarded_at,
    lastContactAt: r.last_contact_at,
    lastInflowAt: r.last_inflow_at,
    redemptionRiskFlaggedAt: r.redemption_risk_flagged_at,
    redemptionAmt180d: Number(r.red_amt_180d),
    redemptionCount180d: Number(r.red_count_180d),
    netFlow365d: Number(r.net_flow_365d),
    activeSips: Number(r.active_sips),
    sipStops90d: Number(r.sip_stops_90d),
    sipRejections90d: Number(r.sip_rej_90d),
    currentValue: Number(r.aum),
    xirr,
  };
  return churnScore(signals);
}

export type ChurnRow = {
  investorId: string;
  name: string;
  phone: string | null;
  rmId: string | null;
  serviceTier: string | null;
  aum: number;
  result: ChurnResult;
};

export async function scanChurn(
  tx: Tx,
  opts: { limit?: number; minBand?: "medium" | "high"; rmId?: string } = {}
): Promise<ChurnRow[]> {
  // RM scope: when an rmId is passed (a non-manager viewing their own book),
  // only that RM's clients are scanned — managers pass no rmId and see the firm.
  const rmScope = opts.rmId ? sql` AND i.rm_id = ${opts.rmId}::uuid` : sql``;
  const res = await tx.execute(sql`
    SELECT
      i.id, i.name, i.phone, i.status, i.service_tier, i.onboarded_at,
      i.last_contact_at, i.redemption_risk_flagged_at, i.rm_id,
      COALESCE(i.aum, 0)::numeric AS aum,
      COALESCE(i.lifetime_inflow, 0)::numeric AS lifetime_inflow,
      COALESCE(i.lifetime_outflow, 0)::numeric AS lifetime_outflow,
      COUNT(t.id) FILTER (WHERE t.direction = 'outflow' AND t.order_date > CURRENT_DATE - 180) AS red_count_180d,
      COALESCE(SUM(t.amount::numeric) FILTER (WHERE t.direction = 'outflow' AND t.order_date > CURRENT_DATE - 180), 0) AS red_amt_180d,
      COALESCE(SUM(CASE WHEN t.direction = 'inflow' THEN t.amount::numeric ELSE -t.amount::numeric END)
               FILTER (WHERE t.order_date > CURRENT_DATE - 365), 0) AS net_flow_365d,
      MAX(t.order_date) FILTER (WHERE t.direction = 'inflow') AS last_inflow_at,
      (SELECT COUNT(*) FROM sips s WHERE s.investor_id = i.id AND s.status = 'active') AS active_sips,
      (SELECT COUNT(*) FROM sips s WHERE s.investor_id = i.id AND s.status = 'stopped' AND s.updated_at > now() - interval '90 days') AS sip_stops_90d,
      (SELECT COUNT(*) FROM sip_rejections r WHERE r.investor_id = i.id AND r.rejection_date > CURRENT_DATE - 90) AS sip_rej_90d
    FROM investors i
    LEFT JOIN transactions t ON t.investor_id = i.id AND t.status IN ('processed', 'successful')
    WHERE i.status IN ('active', 'dormant') AND i.deleted_at IS NULL${rmScope}
    GROUP BY i.id
  `);

  const rows = (res.rows as any[]).map((r): ChurnRow => {
    // Cheap absolute-return proxy: how the current value compares to net invested
    // (money still in the market). No NAV join needed — uses the maintained
    // lifetime inflow/outflow totals. Only meaningful when there's net money in.
    const aum = Number(r.aum);
    const netInvested = Number(r.lifetime_inflow) - Number(r.lifetime_outflow);
    const absoluteReturnPct = netInvested > 0 ? (aum - netInvested) / netInvested : null;
    const result = churnScore({
      status: r.status,
      serviceTier: r.service_tier,
      onboardedAt: r.onboarded_at,
      lastContactAt: r.last_contact_at,
      lastInflowAt: r.last_inflow_at,
      redemptionRiskFlaggedAt: r.redemption_risk_flagged_at,
      redemptionAmt180d: Number(r.red_amt_180d),
      redemptionCount180d: Number(r.red_count_180d),
      netFlow365d: Number(r.net_flow_365d),
      activeSips: Number(r.active_sips),
      sipStops90d: Number(r.sip_stops_90d),
      sipRejections90d: Number(r.sip_rej_90d),
      currentValue: aum,
      xirr: null,
      absoluteReturnPct,
    });
    return {
      investorId: r.id,
      name: r.name,
      phone: r.phone,
      rmId: r.rm_id,
      serviceTier: r.service_tier,
      aum: Number(r.aum),
      result,
    };
  });

  const minScore = opts.minBand === "high" ? 60 : opts.minBand === "medium" ? 34 : 0;
  const filtered = rows
    .filter((r) => r.result.score >= minScore)
    .sort((a, b) => b.result.score - a.result.score);

  return opts.limit ? filtered.slice(0, opts.limit) : filtered;
}
