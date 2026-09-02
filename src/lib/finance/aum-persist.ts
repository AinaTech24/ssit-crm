/**
 * Persist live AUM. SERVER-ONLY (imports the DB).
 *
 * The headline finding of the platform audit: `investors.aum` (and the
 * `folios` rollup) were stored numbers populated at import and never
 * recomputed against live NAV — so firm AUM, RM scorecards, service-tiering,
 * the Excel export, the client review report and the commission "expected"
 * calc all drifted the moment NAV moved. These helpers close that gap by
 * revaluing against the live AMFI NAV feed (`scheme_nav`).
 *
 *   recomputeAllAum(tx)      — investors.aum = net units × latest NAV, set-based,
 *                              for every investor in the current tenant context
 *                              that has a transaction basis. Investors with NO
 *                              completed transactions are left untouched (we have
 *                              nothing better than their imported figure — never
 *                              zero a book we can't value).
 *   revalueAllFolios(tx)     — refresh folios.aum + each folios.schemes[].nav/value
 *                              by repricing the CAS-sourced units at live NAV
 *                              (units are authoritative from the feed; only NAV ×
 *                              value are refreshed). Powers the review report and
 *                              the commission reconciler's expected-AUM.
 *
 * Both run inside a withTenant() tx (RLS scopes the rows). They mirror the
 * exact valuation logic in src/lib/finance/valuation.ts (priced holdings only,
 * dust units treated as fully redeemed).
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { folios } from "@/db/schema";

/**
 * Recompute investors.aum from live valuation (Σ net units × latest NAV over
 * priced holdings), set-based. Only investors with a completed-transaction
 * basis are updated; returns how many rows actually changed plus the new firm
 * AUM total for metrics.
 */
export async function recomputeAllAum(
  tx: Tx
): Promise<{ updated: number; totalAum: number }> {
  const res = await tx.execute(sql`
    WITH holding AS (
      SELECT t.investor_id,
             COALESCE(t.scheme_code, t.scheme_name, 'unknown') AS skey,
             SUM(CASE WHEN t.direction = 'inflow' THEN t.units ELSE -t.units END) AS net_units,
             MAX(n.nav) AS nav
      FROM transactions t
      LEFT JOIN scheme_nav n ON n.scheme_code = t.scheme_code
      WHERE t.status IN ('processed', 'successful')
        AND t.order_date IS NOT NULL
      GROUP BY t.investor_id, COALESCE(t.scheme_code, t.scheme_name, 'unknown')
    ),
    val AS (
      SELECT investor_id,
             COALESCE(
               SUM(net_units * nav) FILTER (WHERE nav IS NOT NULL AND net_units > 0.0005),
               0
             ) AS current_value
      FROM holding
      GROUP BY investor_id
    )
    UPDATE investors i
       SET aum = ROUND(val.current_value::numeric, 2),
           updated_at = now()
      FROM val
     WHERE val.investor_id = i.id
       AND i.aum IS DISTINCT FROM ROUND(val.current_value::numeric, 2)
    RETURNING i.id
  `);
  const updated = (res.rows as any[]).length;

  const totalRes = await tx.execute(
    sql`SELECT COALESCE(SUM(aum), 0)::numeric AS total FROM investors WHERE deleted_at IS NULL`
  );
  const totalAum = Number((totalRes.rows[0] as any)?.total ?? 0);
  return { updated, totalAum };
}

/**
 * Combined valuation: investors.aum = folio-holdings value (the CAS/RTA register
 * is the base) PLUS transaction-derived value for any scheme the folios DON'T
 * already cover (so a transaction-only book still values, and a mixed book isn't
 * double-counted on shared schemes). This is what the investor profile headline,
 * firm AUM, scorecards and the Excel export read.
 *
 * Why this exists: `recomputeAllAum` values ONLY from transactions and leaves
 * holdings-only investors (RTA folio-master / CAS imports, no transaction feed)
 * untouched — so their headline AUM sat at the created default (₹0) even though
 * their folios carried real holdings. This rolls those holdings up.
 *
 * Never-zero is preserved: an investor with neither folios nor a transaction
 * basis is not in the result set and is left untouched (we don't zero a book we
 * can't value). Same `{ updated, totalAum }` shape as recomputeAllAum — drop-in.
 */
export async function recomputeCombinedAum(
  tx: Tx
): Promise<{ updated: number; totalAum: number }> {
  const res = await tx.execute(sql`
    WITH folio_holdings AS (
      -- Base: each investor's total holdings value from the folio register.
      SELECT investor_id, COALESCE(SUM(aum), 0)::numeric AS folio_aum
      FROM folios
      WHERE investor_id IS NOT NULL
      GROUP BY investor_id
    ),
    folio_scheme_codes AS (
      -- Scheme codes already represented in an investor's folios — used to skip
      -- the same scheme in the transaction ledger (no double count).
      SELECT DISTINCT f.investor_id, (s->>'schemeCode') AS scheme_code
      FROM folios f
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(f.schemes, '[]'::jsonb)) AS s
      WHERE f.investor_id IS NOT NULL
        AND (s->>'schemeCode') IS NOT NULL AND (s->>'schemeCode') <> ''
    ),
    txn_holding AS (
      SELECT t.investor_id,
             COALESCE(t.scheme_code, t.scheme_name, 'unknown') AS skey,
             SUM(CASE WHEN t.direction = 'inflow' THEN t.units ELSE -t.units END) AS net_units,
             MAX(n.nav) AS nav
      FROM transactions t
      LEFT JOIN scheme_nav n ON n.scheme_code = t.scheme_code
      WHERE t.status IN ('processed', 'successful')
        AND t.order_date IS NOT NULL
      GROUP BY t.investor_id, COALESCE(t.scheme_code, t.scheme_name, 'unknown')
    ),
    txn_uncovered AS (
      -- Layer: transaction value ONLY for schemes the folios don't cover.
      SELECT th.investor_id,
             COALESCE(
               SUM(th.net_units * th.nav) FILTER (WHERE th.nav IS NOT NULL AND th.net_units > 0.0005),
               0
             ) AS txn_value
      FROM txn_holding th
      WHERE NOT EXISTS (
        SELECT 1 FROM folio_scheme_codes fsc
        WHERE fsc.investor_id = th.investor_id AND fsc.scheme_code = th.skey
      )
      GROUP BY th.investor_id
    ),
    combined AS (
      SELECT investor_id, SUM(v)::numeric AS total FROM (
        SELECT investor_id, folio_aum AS v FROM folio_holdings
        UNION ALL
        SELECT investor_id, txn_value AS v FROM txn_uncovered
      ) u
      GROUP BY investor_id
    )
    UPDATE investors i
       SET aum = ROUND(combined.total::numeric, 2),
           updated_at = now()
      FROM combined
     WHERE combined.investor_id = i.id
       AND i.aum IS DISTINCT FROM ROUND(combined.total::numeric, 2)
    RETURNING i.id
  `);
  const updated = (res.rows as any[]).length;

  const totalRes = await tx.execute(
    sql`SELECT COALESCE(SUM(aum), 0)::numeric AS total FROM investors WHERE deleted_at IS NULL`
  );
  const totalAum = Number((totalRes.rows[0] as any)?.total ?? 0);
  return { updated, totalAum };
}

/**
 * Recompute ONE investor's cached aum + active_sip_amount from live data, in
 * the current tenant tx. Mirrors recomputeCombinedAum's folios-base + uncovered-
 * transaction-layer logic but scoped to a single id — used after a merge so the
 * survivor's headline figures reflect the holdings it just absorbed (otherwise
 * they stay stale until the nightly recompute). Never zeroes a book it can't
 * value: if there's no folio/transaction basis the columns are set to 0 only
 * when they already differ.
 */
export async function recomputeInvestorAum(tx: Tx, investorId: string): Promise<void> {
  await tx.execute(sql`
    WITH folio_holdings AS (
      SELECT investor_id, COALESCE(SUM(aum), 0)::numeric AS folio_aum
      FROM folios
      WHERE investor_id = ${investorId}::uuid
      GROUP BY investor_id
    ),
    folio_scheme_codes AS (
      SELECT DISTINCT f.investor_id, (s->>'schemeCode') AS scheme_code
      FROM folios f
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(f.schemes, '[]'::jsonb)) AS s
      WHERE f.investor_id = ${investorId}::uuid
        AND (s->>'schemeCode') IS NOT NULL AND (s->>'schemeCode') <> ''
    ),
    txn_holding AS (
      SELECT t.investor_id,
             COALESCE(t.scheme_code, t.scheme_name, 'unknown') AS skey,
             SUM(CASE WHEN t.direction = 'inflow' THEN t.units ELSE -t.units END) AS net_units,
             MAX(n.nav) AS nav
      FROM transactions t
      LEFT JOIN scheme_nav n ON n.scheme_code = t.scheme_code
      WHERE t.investor_id = ${investorId}::uuid
        AND t.status IN ('processed', 'successful')
        AND t.order_date IS NOT NULL
      GROUP BY t.investor_id, COALESCE(t.scheme_code, t.scheme_name, 'unknown')
    ),
    txn_uncovered AS (
      SELECT th.investor_id,
             COALESCE(SUM(th.net_units * th.nav) FILTER (WHERE th.nav IS NOT NULL AND th.net_units > 0.0005), 0) AS txn_value
      FROM txn_holding th
      WHERE NOT EXISTS (
        SELECT 1 FROM folio_scheme_codes fsc
        WHERE fsc.investor_id = th.investor_id AND fsc.scheme_code = th.skey
      )
      GROUP BY th.investor_id
    ),
    combined AS (
      SELECT investor_id, SUM(v)::numeric AS total FROM (
        SELECT investor_id, folio_aum AS v FROM folio_holdings
        UNION ALL
        SELECT investor_id, txn_value AS v FROM txn_uncovered
      ) u
      GROUP BY investor_id
    )
    UPDATE investors i
       SET aum = ROUND(COALESCE(combined.total, 0)::numeric, 2),
           updated_at = now()
      FROM combined
     WHERE i.id = ${investorId}::uuid
       AND combined.investor_id = i.id
       AND i.aum IS DISTINCT FROM ROUND(COALESCE(combined.total, 0)::numeric, 2)
  `);

  // active_sip_amount = Σ live SIP book (same rule as the nightly backfill).
  await tx.execute(sql`
    UPDATE investors i
       SET active_sip_amount = COALESCE((
             SELECT SUM(s.amount::numeric) FROM sips s
             WHERE s.investor_id = i.id AND s.status = 'active'
           ), 0),
           updated_at = now()
     WHERE i.id = ${investorId}::uuid
       AND i.active_sip_amount IS DISTINCT FROM COALESCE((
             SELECT SUM(s.amount::numeric) FROM sips s
             WHERE s.investor_id = i.id AND s.status = 'active'
           ), 0)
  `);
}

type FolioScheme = {
  schemeCode: string;
  schemeName: string;
  category?: string;
  units?: number;
  nav?: number;
  value?: number;
};

/**
 * Reprice CAS-sourced folio holdings at live NAV. Units come from the feed and
 * are left as-is; only nav + value are refreshed and the folio aum re-summed. A
 * holding whose scheme has no live NAV keeps its prior value in the rollup (so
 * an un-priceable scheme never silently zeroes a folio).
 */
export async function revalueAllFolios(
  tx: Tx,
  batchSize = 500
): Promise<{ folios: number }> {
  // One pull of the (platform-shared) NAV master, indexed by scheme code.
  const navRes = await tx.execute(
    sql`SELECT scheme_code, nav FROM scheme_nav WHERE nav IS NOT NULL`
  );
  const navMap = new Map<string, number>();
  for (const r of navRes.rows as Array<{ scheme_code: string | null; nav: string | number }>) {
    if (r.scheme_code != null) {
      const nav = Number(r.nav);
      if (isFinite(nav) && nav > 0) navMap.set(String(r.scheme_code), nav);
    }
  }
  if (navMap.size === 0) return { folios: 0 };

  let offset = 0;
  let changedFolios = 0;

  for (;;) {
    const page = await tx
      .select()
      .from(folios)
      .orderBy(folios.id)
      .limit(batchSize)
      .offset(offset);
    if (page.length === 0) break;

    // Reprice every folio in the page in memory, then flush all the changed
    // rows in ONE set-based UPDATE ... FROM (VALUES ...) per page. The earlier
    // implementation issued one UPDATE round-trip per folio (10k folios ≈ 10k
    // round-trips ≈ 7s/tenant); batching collapses that to ~batchSize/page
    // statements and brings a 10k-folio tenant well under a second.
    const updates: Array<ReturnType<typeof sql>> = [];
    for (const f of page) {
      const schemes = (f.schemes ?? []) as FolioScheme[];
      if (!schemes.length) continue;

      let folioAum = 0;
      let changed = false;
      const next = schemes.map((s) => {
        const units = Number(s.units ?? 0);
        const liveNav = s.schemeCode ? navMap.get(String(s.schemeCode)) : undefined;
        if (liveNav != null && isFinite(units) && units > 0) {
          const value = Math.round(units * liveNav * 100) / 100;
          if (s.nav !== liveNav || s.value !== value) changed = true;
          folioAum += value;
          return { ...s, nav: liveNav, value };
        }
        // Un-priceable scheme — keep whatever value was there.
        folioAum += Number(s.value ?? 0);
        return s;
      });

      const roundedAum = Math.round(folioAum * 100) / 100;
      if (changed || Number(f.aum ?? 0) !== roundedAum) {
        updates.push(
          sql`(${f.id}::uuid, ${JSON.stringify(next)}::jsonb, ${roundedAum}::numeric)`
        );
        changedFolios++;
      }
    }

    if (updates.length > 0) {
      await tx.execute(sql`
        UPDATE folios f
           SET schemes = v.schemes,
               aum = v.aum,
               updated_at = now()
          FROM (VALUES ${sql.join(updates, sql`, `)}) AS v(id, schemes, aum)
         WHERE f.id = v.id
      `);
    }

    offset += batchSize;
  }

  return { folios: changedFolios };
}
