/**
 * Three-way holdings reconciliation engine.
 *
 * For every (investor, scheme) it matches three legs and records a reviewable
 * exception when they disagree — unlike the old scanner, which only emitted
 * events and never produced a matched break list:
 *
 *   leg 1  CRM ledger units   Σ(inflow − outflow units) from `transactions`
 *   leg 2  RTA/CAS-stated     Σ units from `folios.schemes[]` (the feed snapshot)
 *   leg 3  live valuation     units × latest AMFI NAV (`scheme_nav`) → materiality
 *
 * Exception types:
 *   unit_mismatch   both legs have the scheme but units differ materially
 *   missing_in_crm  CAS shows units with no transaction trail in the CRM
 *   missing_in_feed CRM ledger implies units the CAS feed doesn't show
 *
 * Idempotent: upserts on (tenant, dedup_key) so a persistent break stays one
 * row; a break that healed since the last run is auto-resolved. Runs inside a
 * withTenant() tx (RLS scopes every table).
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

export type ReconcileResult = {
  runId: string;
  scanned: number;
  exceptionsOpen: number;
  high: number;
  autoResolved: number;
};

/** Units below this are treated as dust / rounding, not a real break. */
const UNIT_TOLERANCE = 0.5;

export async function reconcileHoldings(tx: Tx, tenantId: string): Promise<ReconcileResult> {
  // 1) Open a run row; run_at is the watermark for auto-resolving stale breaks.
  const runRow = await tx.execute(sql`
    INSERT INTO reconciliation_runs (tenant_id, kind, status) VALUES (${tenantId}::uuid, 'holdings', 'running')
    RETURNING id, run_at
  `);
  const runId = (runRow.rows[0] as any).id as string;
  const runAt = (runRow.rows[0] as any).run_at as string;

  // 2) Match the three legs and upsert exceptions. crm/cas are aggregated to
  //    (investor, scheme) so inconsistent folio tagging never creates noise.
  const upsert = await tx.execute(sql`
    WITH crm AS (
      SELECT investor_id, scheme_code,
             MAX(scheme_name) AS scheme_name,
             SUM(CASE WHEN direction = 'inflow' THEN COALESCE(units,0) ELSE -COALESCE(units,0) END) AS units
      FROM transactions
      WHERE status IN ('processed','successful') AND scheme_code IS NOT NULL
      GROUP BY investor_id, scheme_code
    ),
    cas AS (
      SELECT f.investor_id, (s->>'schemeCode') AS scheme_code,
             MAX(s->>'schemeName') AS scheme_name,
             SUM(NULLIF(s->>'units','')::numeric) AS units
      FROM folios f
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(f.schemes, '[]'::jsonb)) AS s
      WHERE (s->>'schemeCode') IS NOT NULL
      GROUP BY f.investor_id, (s->>'schemeCode')
    ),
    matched AS (
      SELECT
        COALESCE(crm.investor_id, cas.investor_id) AS investor_id,
        COALESCE(crm.scheme_code, cas.scheme_code) AS scheme_code,
        COALESCE(crm.scheme_name, cas.scheme_name) AS scheme_name,
        COALESCE(crm.units, 0) AS crm_units,
        COALESCE(cas.units, 0) AS cas_units,
        n.nav AS nav
      FROM crm
      FULL OUTER JOIN cas ON cas.investor_id = crm.investor_id AND cas.scheme_code = crm.scheme_code
      LEFT JOIN scheme_nav n ON n.scheme_code = COALESCE(crm.scheme_code, cas.scheme_code)
    ),
    classified AS (
      SELECT
        investor_id, scheme_code, scheme_name, crm_units, cas_units, nav,
        (crm_units - cas_units) AS delta_units,
        ABS(crm_units - cas_units) * COALESCE(nav, 0) AS value_impact,
        CASE
          WHEN crm_units <= 0.0005 AND cas_units > 0.0005 THEN 'missing_in_crm'
          WHEN cas_units <= 0.0005 AND crm_units > 0.0005 THEN 'missing_in_feed'
          ELSE 'unit_mismatch'
        END AS exception_type
      FROM matched
      WHERE ABS(crm_units - cas_units) > ${UNIT_TOLERANCE}
    )
    INSERT INTO reconciliation_exceptions (
      tenant_id, run_id, investor_id, scheme_code, scheme_name, exception_type, severity,
      crm_units, feed_units, delta_units, crm_value, feed_value, delta_value,
      status, dedup_key, detected_at, last_seen_at, updated_at
    )
    SELECT
      ${tenantId}::uuid, ${runId}::uuid, investor_id, scheme_code, scheme_name, exception_type,
      CASE WHEN value_impact >= 100000 THEN 'high' WHEN value_impact >= 10000 THEN 'medium' ELSE 'low' END,
      ROUND(crm_units, 4), ROUND(cas_units, 4), ROUND(delta_units, 4),
      ROUND(crm_units * COALESCE(nav,0), 2), ROUND(cas_units * COALESCE(nav,0), 2),
      ROUND((crm_units - cas_units) * COALESCE(nav,0), 2),
      'open',
      'rec:' || md5(investor_id::text || '|' || scheme_code || '|' || exception_type),
      now(), now(), now()
    FROM classified
    ON CONFLICT (tenant_id, dedup_key) DO UPDATE SET
      run_id = EXCLUDED.run_id,
      scheme_name = EXCLUDED.scheme_name,
      severity = EXCLUDED.severity,
      crm_units = EXCLUDED.crm_units,
      feed_units = EXCLUDED.feed_units,
      delta_units = EXCLUDED.delta_units,
      crm_value = EXCLUDED.crm_value,
      feed_value = EXCLUDED.feed_value,
      delta_value = EXCLUDED.delta_value,
      last_seen_at = now(),
      updated_at = now(),
      -- a break that reappears after being resolved re-opens; investigating/ignored are left as set
      status = CASE WHEN reconciliation_exceptions.status = 'resolved' THEN 'open' ELSE reconciliation_exceptions.status END
    RETURNING id
  `);
  const upserted = (upsert.rows as any[]).length;

  // 3) Auto-resolve breaks that healed (open/investigating but not re-detected
  //    this run → their last_seen_at predates this run's watermark).
  const resolved = await tx.execute(sql`
    UPDATE reconciliation_exceptions
       SET status = 'resolved', resolved_at = now(), updated_at = now(),
           notes = COALESCE(notes,'') || ' [auto-resolved: matched on ' || ${runAt}::text || ']'
     WHERE tenant_id = ${tenantId}::uuid
       AND status IN ('open','investigating')
       AND last_seen_at < ${runAt}::timestamptz
    RETURNING id
  `);
  const autoResolved = (resolved.rows as any[]).length;

  // 4) Tally open exceptions + finalise the run row.
  const tally = await tx.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status IN ('open','investigating'))::int AS open,
      COUNT(*) FILTER (WHERE status IN ('open','investigating') AND severity = 'high')::int AS high
    FROM reconciliation_exceptions WHERE tenant_id = ${tenantId}::uuid
  `);
  const open = Number((tally.rows[0] as any)?.open ?? 0);
  const high = Number((tally.rows[0] as any)?.high ?? 0);

  await tx.execute(sql`
    UPDATE reconciliation_runs
       SET scanned = ${upserted}, exceptions_found = ${open}, status = 'completed'
     WHERE id = ${runId}::uuid
  `);

  return { runId, scanned: upserted, exceptionsOpen: open, high, autoResolved };
}
