/**
 * Backfill / on-demand live-AUM revaluation.
 *
 * Reprices every folio's holdings at the latest AMFI NAV and recomputes
 * investors.aum from live valuation (net units × latest NAV). The nightly
 * daily-ops scanner does this automatically; this script lets you run it now
 * (e.g. right after a NAV refresh or a fresh RTA import) and reports the deltas.
 *
 * Idempotent. Safe in prod.
 *
 * Usage:
 *   npx tsx scripts/backfill-aum.ts
 */

import "dotenv/config";
import { sql } from "drizzle-orm";

// Cross-tenant maintenance ⇒ needs system (RLS-bypassing) access to list tenants.
process.env.ALLOW_SYSTEM_TX = process.env.ALLOW_SYSTEM_TX ?? "1";

import { withSystem, withTenant } from "../src/db/client";
import { recomputeCombinedAum, revalueAllFolios } from "../src/lib/finance/aum-persist";

async function main() {
  const tenants = await withSystem(async (tx) =>
    (
      await tx.execute(sql`SELECT id FROM tenants WHERE status IN ('active','trial')`)
    ).rows as Array<{ id: string }>
  );

  let totFolios = 0;
  let totInvestors = 0;
  for (const { id: tenantId } of tenants) {
    await withTenant(tenantId, async (tx) => {
      const f = await revalueAllFolios(tx);
      const a = await recomputeCombinedAum(tx);
      totFolios += f.folios;
      totInvestors += a.updated;
      console.log(
        `[backfill-aum] tenant ${tenantId.slice(0, 8)}… folios repriced ${f.folios}, ` +
          `investors AUM updated ${a.updated}, firm AUM now ₹${a.totalAum.toLocaleString("en-IN")}`
      );
    });
  }

  console.log(
    `\n[backfill-aum] done — ${tenants.length} tenant(s); ` +
      `${totFolios} folio(s) repriced, ${totInvestors} investor AUM(s) updated.`
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("\n[backfill-aum] failed:", e?.message ?? e);
  process.exit(1);
});
