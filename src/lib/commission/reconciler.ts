/**
 * Brokerage reconciliation engine.
 *
 * Inputs:
 *   - amc_payouts rows for the given period (loaded from CAMS/KFin feeds)
 *   - transactions + folios (to compute average AUM per scheme per month)
 *   - empanelment trail rates per AMC × scheme (per_annum %)
 *
 * Output:
 *   - One commission_records row per (period × AMC × scheme) with
 *     expected, received, variance, status.
 *
 * Default trail-rate fallback when empanelment slab missing: 0.85% p.a. for
 * equity, 0.30% for debt, 0.50% for hybrid (conservative; real numbers vary).
 * MFDs override these via the empanelment doc upload flow later.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { trailRate } from "@/lib/finance/trail-rates";

/** Normalize a scheme name for fuzzy matching across RTA/payout code formats:
 *  lower-case, drop plan/option noise, alphanumerics only. */
function normSchemeName(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/\b(regular|direct|growth|idcw|dividend|payout|reinvest(ment)?|plan|option|fund|scheme)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type ReconcilerResult = {
  period: string;
  rowsComputed: number;
  totalExpected: number;
  totalReceived: number;
  totalVariance: number;
  anomalies: number;
};

/**
 * Run reconciliation for a single (tenantId, period) inside an open transaction.
 * Caller is responsible for opening the withTenant transaction.
 */
export async function reconcilePeriod(
  tx: Tx,
  tenantId: string,
  period: string,
  varianceThresholdPct = 0.02
): Promise<ReconcilerResult> {
  // 1. Pull received payouts for the period, grouped by (amc, scheme)
  const received = await tx.execute(sql`
    SELECT amc_code, COALESCE(scheme_code, '__NO_SCHEME__') AS scheme_code,
           MIN(scheme_name) AS scheme_name,
           SUM(net_amount::numeric) AS received
    FROM amc_payouts
    WHERE tenant_id = ${tenantId} AND period = ${period}
    GROUP BY amc_code, COALESCE(scheme_code, '__NO_SCHEME__')
  `);

  // 2. Compute expected from folios: for each (amc, scheme) sum avg AUM × trail
  //    Simplification: we treat current folio AUM as the month's average. In
  //    production the parser computes monthly mid-AUM from the daily feed.
  const expected = await tx.execute(sql`
    WITH scheme_aum AS (
      SELECT f.amc_code,
             elem->>'schemeCode' AS scheme_code,
             elem->>'schemeName' AS scheme_name,
             elem->>'category' AS category,
             SUM(COALESCE((elem->>'value')::numeric, 0)) AS aum
      FROM folios f
      LEFT JOIN LATERAL jsonb_array_elements(COALESCE(f.schemes, '[]'::jsonb)) elem ON true
      WHERE f.tenant_id = ${tenantId}
      GROUP BY f.amc_code, elem->>'schemeCode', elem->>'schemeName', elem->>'category'
    )
    SELECT amc_code, COALESCE(scheme_code, '__NO_SCHEME__') AS scheme_code,
           MIN(scheme_name) AS scheme_name, MIN(category) AS category, SUM(aum) AS aum
    FROM scheme_aum
    GROUP BY amc_code, COALESCE(scheme_code, '__NO_SCHEME__')
  `);

  // Load per-AMC trail-rate overrides from the empanelment register.
  // When set, we use the negotiated rate instead of the category fallback
  // — this is the difference between "we'd expect ~₹2L" and "they
  // promised us 0.85% which on this AUM is ₹X" in the variance column.
  const overrides = await tx.execute(sql`
    SELECT amc_code, trail_rate_override_pct
    FROM amc_empanelments
    WHERE tenant_id = ${tenantId}
      AND status = 'empanelled'
      AND trail_rate_override_pct IS NOT NULL
  `);
  const overrideByAmc = new Map<string, number>();
  for (const row of overrides.rows as any[]) {
    overrideByAmc.set(
      row.amc_code,
      Number(row.trail_rate_override_pct) / 100
    );
  }

  // Merge by (amc, scheme)
  const map = new Map<string, { amcCode: string; schemeCode: string; schemeName?: string; expected: number; received: number; category?: string }>();
  for (const row of expected.rows as any[]) {
    const key = `${row.amc_code}|${row.scheme_code}`;
    const trail = overrideByAmc.get(row.amc_code) ?? trailRate(row.category);
    map.set(key, {
      amcCode: row.amc_code,
      schemeCode: row.scheme_code === "__NO_SCHEME__" ? "" : row.scheme_code,
      schemeName: row.scheme_name,
      category: row.category,
      expected: Number(row.aum ?? 0) * (trail / 12),
      received: 0,
    });
  }
  // Secondary index of expected entries by normalized scheme NAME, so a received
  // line whose scheme_code differs from the folio's (different RTA code format,
  // ISIN-vs-AMFI-code, etc.) still merges into its expected row instead of
  // creating a phantom received-only "anomaly".
  const expectedByName = new Map<string, string>(); // `${amc}|${normName}` → map key
  for (const [k, v] of map) {
    if (v.schemeName) expectedByName.set(`${v.amcCode}|${normSchemeName(v.schemeName)}`, k);
  }
  for (const row of received.rows as any[]) {
    const exactKey = `${row.amc_code}|${row.scheme_code}`;
    let target = map.get(exactKey);
    if (!target && row.scheme_name) {
      const mappedKey = expectedByName.get(`${row.amc_code}|${normSchemeName(row.scheme_name)}`);
      if (mappedKey) target = map.get(mappedKey);
    }
    if (target) {
      target.received += Number(row.received ?? 0);
    } else {
      map.set(exactKey, {
        amcCode: row.amc_code,
        schemeCode: row.scheme_code === "__NO_SCHEME__" ? "" : row.scheme_code,
        schemeName: row.scheme_name,
        expected: 0,
        received: Number(row.received ?? 0),
      });
    }
  }

  // 3. Upsert commission_records
  let rowsComputed = 0;
  let totalExpected = 0;
  let totalReceived = 0;
  let totalVariance = 0;
  let anomalies = 0;

  for (const v of map.values()) {
    const variance = v.received - v.expected;
    const variancePct = v.expected > 0 ? variance / v.expected : v.received > 0 ? 1 : 0;
    const status =
      v.expected === 0 && v.received === 0
        ? "pending"
        : Math.abs(variancePct) > varianceThresholdPct
        ? "anomaly"
        : "matched";

    if (status === "anomaly") anomalies++;
    totalExpected += v.expected;
    totalReceived += v.received;
    totalVariance += variance;

    await tx.execute(sql`
      INSERT INTO commission_records (
        id, tenant_id, period, amc_code, scheme_code, scheme_name,
        trail_rate_pct, expected_amount, received_amount, variance, variance_pct, status,
        created_at, updated_at
      )
      VALUES (
        gen_random_uuid(), ${tenantId}, ${period}, ${v.amcCode}, ${v.schemeCode}, ${v.schemeName ?? null},
        ${(overrideByAmc.get(v.amcCode) ?? trailRate(v.category)) * 100}, ${v.expected}, ${v.received}, ${variance}, ${variancePct},
        ${status}, now(), now()
      )
      ON CONFLICT (tenant_id, period, amc_code, scheme_code) DO UPDATE
      SET expected_amount = EXCLUDED.expected_amount,
          received_amount = EXCLUDED.received_amount,
          variance = EXCLUDED.variance,
          variance_pct = EXCLUDED.variance_pct,
          status = CASE WHEN commission_records.status IN ('investigating','resolved','written_off')
                        THEN commission_records.status ELSE EXCLUDED.status END,
          updated_at = now()
    `);
    rowsComputed++;
  }

  return { period, rowsComputed, totalExpected, totalReceived, totalVariance, anomalies };
}
