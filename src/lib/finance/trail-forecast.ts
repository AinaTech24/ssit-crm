/**
 * Trail-income forecast + revenue-at-risk.
 *
 * The single number an MFD owner cares about most: "what will my trail income
 * be, and how much of it is at risk?" Derived entirely from data we already
 * hold — no external feed required:
 *
 *   Projected annual trail = Σ (scheme AUM × trail rate)
 *      where trail rate = empanelment override (if set) else category fallback
 *
 *   Revenue at risk =
 *      redemption drag  (trail lost on AUM redeemed in the last 30 days)
 *    + at-risk SIP trail (future trail on annualised at-risk SIP inflow)
 *
 * Trail rates come from src/lib/finance/trail-rates.ts — the SAME source the
 * brokerage reconciler uses, so the forecast and the reconciliation agree.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { trailRate, sipAnnualAmount, FALLBACK_TRAIL } from "@/lib/finance/trail-rates";

export type SliceRow = { key: string; label: string; aum: number; annualTrail: number; sharePct: number };

export type AtRiskSip = { id: string; client: string; investorId: string | null; monthly: number; annual: number; reason: string };
export type RedeemedClient = { client: string; investorId: string | null; amount: number; trailLost: number };

export type TrailForecast = {
  totalAum: number;
  weightedTrailPct: number; // blended annual trail %, e.g. 0.72
  projectedAnnual: number;
  projectedMonthly: number;
  /** Net monthly SIP inflow from HEALTHY active SIPs — drives the forward curve. */
  netMonthlySipInflow: number;
  /** Trail commission actually received over the trailing 12 months (amc_payouts). */
  received12mo: number;
  byAmc: SliceRow[];
  byCategory: SliceRow[];
  byRm: SliceRow[];
  byClient: SliceRow[];
  atRiskSipList: AtRiskSip[];
  redeemedClients: RedeemedClient[];
  atRisk: {
    redemptionOutflow30d: number;
    redemptionTrailLost: number;
    redemptionCount: number;
    atRiskSipMonthly: number; // sum of monthly-equivalent at-risk SIP installments
    atRiskSipAnnual: number; // annualised at-risk SIP inflow
    atRiskSipTrail: number; // future trail on that inflow
    atRiskSipCount: number;
    totalRevenueAtRisk: number; // redemptionTrailLost + atRiskSipTrail
  };
};

type DetailRow = { amc_code: string | null; amc_name: string | null; rm_id: string | null; category: string | null; aum: number; investor_id: string | null; investor_name: string | null };

export async function computeTrailForecast(tx: Tx, tenantId: string): Promise<TrailForecast> {
  // ── 1. AUM at (AMC × RM × category) granularity ──────────────────────────
  // Expand folio.schemes jsonb (value + category) where present; for folios
  // with no scheme breakdown, fall back to the folio-level aum (unknown
  // category → default trail). closed_at IS NULL excludes redeemed folios.
  const detail = await tx.execute(sql`
    WITH src AS (
      SELECT f.amc_code, f.amc_name, i.rm_id, i.id AS investor_id, i.name AS investor_name,
             elem->>'category' AS category,
             COALESCE((elem->>'value')::numeric, 0) AS value
      FROM folios f
      JOIN investors i ON i.id = f.investor_id
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(f.schemes, '[]'::jsonb)) elem
      WHERE f.tenant_id = ${tenantId} AND f.closed_at IS NULL AND i.deleted_at IS NULL
      UNION ALL
      SELECT f.amc_code, f.amc_name, i.rm_id, i.id AS investor_id, i.name AS investor_name, NULL AS category, COALESCE(f.aum, 0) AS value
      FROM folios f
      JOIN investors i ON i.id = f.investor_id
      WHERE f.tenant_id = ${tenantId} AND f.closed_at IS NULL AND i.deleted_at IS NULL
        AND COALESCE(jsonb_array_length(COALESCE(f.schemes, '[]'::jsonb)), 0) = 0
    )
    SELECT amc_code, MIN(amc_name) AS amc_name, rm_id, investor_id, MIN(investor_name) AS investor_name, category, SUM(value) AS aum
    FROM src
    GROUP BY amc_code, rm_id, investor_id, category
  `);

  // Per-AMC negotiated trail overrides (win over category fallback).
  const overridesRes = await tx.execute(sql`
    SELECT amc_code, trail_rate_override_pct
    FROM amc_empanelments
    WHERE tenant_id = ${tenantId} AND status = 'empanelled' AND trail_rate_override_pct IS NOT NULL
  `);
  const overrideByAmc = new Map<string, number>();
  for (const r of overridesRes.rows as any[]) {
    overrideByAmc.set(r.amc_code, Number(r.trail_rate_override_pct) / 100);
  }

  // RM display names.
  const rmRes = await tx.execute(sql`
    SELECT id, name FROM users WHERE tenant_id = ${tenantId}
  `);
  const rmName = new Map<string, string>();
  for (const r of rmRes.rows as any[]) rmName.set(r.id, r.name);

  const rate = (amc: string | null, category: string | null): number => {
    const override = amc ? overrideByAmc.get(amc) : undefined;
    return override ?? trailRate(category);
  };

  let totalAum = 0;
  let projectedAnnual = 0;
  const amcAgg = new Map<string, { label: string; aum: number; trail: number }>();
  const catAgg = new Map<string, { label: string; aum: number; trail: number }>();
  const rmAgg = new Map<string, { label: string; aum: number; trail: number }>();
  const clientAgg = new Map<string, { label: string; aum: number; trail: number }>();

  for (const row of detail.rows as unknown as DetailRow[]) {
    const aum = Number(row.aum ?? 0);
    if (!aum) continue;
    const annual = aum * rate(row.amc_code, row.category);
    totalAum += aum;
    projectedAnnual += annual;

    const clientKey = row.investor_id ?? "__noclient__";
    const client = clientAgg.get(clientKey) ?? { label: row.investor_name ?? "Unknown", aum: 0, trail: 0 };
    client.aum += aum;
    client.trail += annual;
    clientAgg.set(clientKey, client);

    const amcKey = row.amc_code ?? "—";
    const amc = amcAgg.get(amcKey) ?? { label: row.amc_name ?? amcKey, aum: 0, trail: 0 };
    amc.aum += aum;
    amc.trail += annual;
    amcAgg.set(amcKey, amc);

    const catKey = normCategory(row.category);
    const cat = catAgg.get(catKey) ?? { label: catKey, aum: 0, trail: 0 };
    cat.aum += aum;
    cat.trail += annual;
    catAgg.set(catKey, cat);

    const rmKey = row.rm_id ?? "__unassigned__";
    const rm = rmAgg.get(rmKey) ?? {
      label: row.rm_id ? rmName.get(row.rm_id) ?? "Unknown RM" : "Unassigned",
      aum: 0,
      trail: 0,
    };
    rm.aum += aum;
    rm.trail += annual;
    rmAgg.set(rmKey, rm);
  }

  const toSlices = (m: Map<string, { label: string; aum: number; trail: number }>): SliceRow[] =>
    [...m.entries()]
      .map(([key, v]) => ({
        key,
        label: v.label,
        aum: v.aum,
        annualTrail: v.trail,
        sharePct: projectedAnnual > 0 ? (v.trail / projectedAnnual) * 100 : 0,
      }))
      .sort((a, b) => b.annualTrail - a.annualTrail);

  // ── 2. Revenue at risk — redemption drag (last 30 days) ───────────────────
  const redRes = await tx.execute(sql`
    SELECT scheme_category, amc_code, COALESCE(SUM(amount::numeric), 0) AS amt, COUNT(*)::int AS n
    FROM transactions
    WHERE tenant_id = ${tenantId}
      AND type IN ('redemption', 'swp')
      AND direction = 'outflow'
      AND status IN ('processed', 'successful', 'pending', 'submitted')
      AND order_date >= (CURRENT_DATE - INTERVAL '30 days')
    GROUP BY scheme_category, amc_code
  `);
  let redemptionOutflow30d = 0;
  let redemptionTrailLost = 0;
  let redemptionCount = 0;
  for (const r of redRes.rows as any[]) {
    const amt = Number(r.amt ?? 0);
    redemptionOutflow30d += amt;
    redemptionTrailLost += amt * rate(r.amc_code, r.scheme_category);
    redemptionCount += Number(r.n ?? 0);
  }

  // ── 3. Revenue at risk — at-risk active SIPs (with the actionable list) ────
  // "At risk" = repeated mandate failures, ending soon, or a dead mandate.
  const sipRes = await tx.execute(sql`
    SELECT s.id, s.amount::numeric AS amount, s.frequency, s.investor_id,
           i.name AS investor_name,
           COALESCE(NULLIF(s.consecutive_failures, '')::int, 0) AS fails,
           s.end_date, m.status AS mandate_status
    FROM sips s
    LEFT JOIN mandates m ON m.id = s.mandate_id
    LEFT JOIN investors i ON i.id = s.investor_id
    WHERE s.tenant_id = ${tenantId}
      AND s.status = 'active'
      AND (
        COALESCE(NULLIF(s.consecutive_failures, '')::int, 0) >= 2
        OR (s.end_date IS NOT NULL AND s.end_date <= (CURRENT_DATE + INTERVAL '60 days'))
        OR m.status IN ('expired', 'rejected', 'cancelled')
      )
    ORDER BY s.amount::numeric DESC
  `);
  let atRiskSipMonthly = 0;
  let atRiskSipAnnual = 0;
  let atRiskSipCount = 0;
  const atRiskSipList: AtRiskSip[] = [];
  for (const r of sipRes.rows as any[]) {
    const amount = Number(r.amount ?? 0);
    const annual = sipAnnualAmount(amount, r.frequency);
    atRiskSipAnnual += annual;
    atRiskSipMonthly += annual / 12;
    atRiskSipCount += 1;
    const reason =
      Number(r.fails ?? 0) >= 2 ? `${r.fails} mandate failures`
      : ["expired", "rejected", "cancelled"].includes(r.mandate_status) ? `mandate ${r.mandate_status}`
      : r.end_date ? "ending within 60 days"
      : "at risk";
    if (atRiskSipList.length < 12) atRiskSipList.push({ id: String(r.id), client: r.investor_name ?? "Unknown", investorId: r.investor_id ?? null, monthly: annual / 12, annual, reason });
  }
  // SIP inflow is predominantly equity — use the equity trail as the estimate.
  const atRiskSipTrail = atRiskSipAnnual * FALLBACK_TRAIL.equity;

  // ── 4. Top redeeming clients (last 30d) — the actionable redemption list ───
  const redClientsRes = await tx.execute(sql`
    SELECT t.investor_id, i.name AS investor_name, t.amc_code, t.scheme_category,
           COALESCE(SUM(t.amount::numeric), 0) AS amt
    FROM transactions t LEFT JOIN investors i ON i.id = t.investor_id
    WHERE t.tenant_id = ${tenantId} AND t.type IN ('redemption','swp') AND t.direction = 'outflow'
      AND t.status IN ('processed','successful','pending','submitted')
      AND t.order_date >= (CURRENT_DATE - INTERVAL '30 days')
    GROUP BY t.investor_id, i.name, t.amc_code, t.scheme_category
    ORDER BY amt DESC LIMIT 12
  `);
  const redeemedClients: RedeemedClient[] = (redClientsRes.rows as any[]).map((r) => {
    const amount = Number(r.amt ?? 0);
    return { client: r.investor_name ?? "Unknown", investorId: r.investor_id ?? null, amount, trailLost: amount * rate(r.amc_code, r.scheme_category) };
  });

  // ── 5. Net monthly SIP inflow from HEALTHY active SIPs (drives the curve) ──
  const healthySipRes = await tx.execute(sql`
    SELECT COALESCE(SUM(
      CASE s.frequency
        WHEN 'monthly' THEN s.amount::numeric
        WHEN 'quarterly' THEN s.amount::numeric / 3
        WHEN 'weekly' THEN s.amount::numeric * 52 / 12
        WHEN 'fortnightly' THEN s.amount::numeric * 26 / 12
        WHEN 'annually' THEN s.amount::numeric / 12
        ELSE s.amount::numeric
      END), 0) AS monthly_inflow
    FROM sips s
    WHERE s.tenant_id = ${tenantId} AND s.status = 'active'
      AND COALESCE(NULLIF(s.consecutive_failures, '')::int, 0) < 2
  `);
  const netMonthlySipInflow = Number((healthySipRes.rows[0] as any)?.monthly_inflow ?? 0);

  // ── 6. Trail commission actually RECEIVED — trailing 12 months (amc_payouts) ─
  const recvRes = await tx.execute(sql`
    SELECT COALESCE(SUM(net_amount::numeric), 0) AS received
    FROM amc_payouts
    WHERE tenant_id = ${tenantId} AND payout_type = 'trail'
      AND period >= to_char(CURRENT_DATE - INTERVAL '12 months', 'YYYY-MM')
  `);
  const received12mo = Number((recvRes.rows[0] as any)?.received ?? 0);

  return {
    totalAum,
    weightedTrailPct: totalAum > 0 ? (projectedAnnual / totalAum) * 100 : 0,
    projectedAnnual,
    projectedMonthly: projectedAnnual / 12,
    netMonthlySipInflow,
    received12mo,
    byAmc: toSlices(amcAgg),
    byCategory: toSlices(catAgg),
    byRm: toSlices(rmAgg),
    byClient: toSlices(clientAgg),
    atRiskSipList,
    redeemedClients,
    atRisk: {
      redemptionOutflow30d,
      redemptionTrailLost,
      redemptionCount,
      atRiskSipMonthly,
      atRiskSipAnnual,
      atRiskSipTrail,
      atRiskSipCount,
      totalRevenueAtRisk: redemptionTrailLost + atRiskSipTrail,
    },
  };
}

function normCategory(category: string | null): string {
  if (!category) return "Unclassified";
  const k = category.toLowerCase();
  if (k.includes("elss") || k.includes("tax")) return "ELSS";
  if (k.includes("liquid") || k.includes("overnight") || k.includes("money market")) return "Liquid";
  if (k.includes("hybrid") || k.includes("balanced") || k.includes("multi")) return "Hybrid";
  if (k.includes("debt") || k.includes("bond") || k.includes("gilt")) return "Debt";
  if (k.includes("equity") || k.includes("flexi") || k.includes("large") || k.includes("mid") || k.includes("small") || k.includes("index"))
    return "Equity";
  return "Other";
}
