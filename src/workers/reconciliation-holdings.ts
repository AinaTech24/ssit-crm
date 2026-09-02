/**
 * Holdings reconciliation sweep — runs the three-way matching engine
 * (src/lib/reconciliation/engine.ts) for every active tenant and reports the
 * total open breaks. Scheduled alongside the daily reconciliation scan (after
 * the NAV refresh + feed ingest, so it reconciles against fresh data).
 */

import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { reconcileHoldings } from "@/lib/reconciliation/engine";

export async function runHoldingsReconciliation(): Promise<{
  tenants: number;
  open: number;
  high: number;
  autoResolved: number;
}> {
  const tenants = await withSystem(async (tx) => {
    const r = await tx.execute(sql`SELECT id FROM tenants WHERE status IN ('active','trial')`);
    return (r.rows as Array<{ id: string }>).map((row) => row.id);
  });

  let open = 0;
  let high = 0;
  let autoResolved = 0;
  // Bounded-concurrency pool — each tenant reconciles independently (own
  // RLS-scoped tx), so a sequential loop over 500 tenants needlessly serialises.
  // Tune with RECON_CONCURRENCY; default 5 (stays well under the pg pool).
  const concurrency = Math.max(1, Number(process.env.RECON_CONCURRENCY ?? 5) || 5);
  const queue = [...tenants];
  const worker = async () => {
    for (;;) {
      const tenantId = queue.shift();
      if (!tenantId) return;
      try {
        const r = await withTenant(tenantId, async (tx) => reconcileHoldings(tx, tenantId));
        open += r.exceptionsOpen;
        high += r.high;
        autoResolved += r.autoResolved;
      } catch (err: any) {
        console.error(`[reconciliation-holdings] tenant ${tenantId} failed:`, err?.message ?? err);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, () => worker())
  );

  console.log(
    `[reconciliation-holdings] swept ${tenants.length} tenant(s) — ${open} open break(s) ` +
      `(${high} high), ${autoResolved} auto-resolved`
  );
  return { tenants: tenants.length, open, high, autoResolved };
}
