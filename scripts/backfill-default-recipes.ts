/**
 * One-off: install the 9 default workflow recipes into every existing
 * tenant that doesn't yet have them. Idempotent — skips any recipe
 * already installed per tenant.
 *
 * Use after deploying the auto-install hook so existing tenants (Demo
 * Wealth, any production tenants from before the hook landed) catch up.
 *
 * Run with: npm run backfill:default-recipes
 */

import "dotenv/config";
import { sql } from "drizzle-orm";
import { withSystem } from "../src/db/client";
import { installDefaultRecipes } from "../src/lib/recipes/install-defaults";

async function main() {
  console.log("[backfill] starting default-recipe backfill…");

  const result = await withSystem(async (tx) => {
    const tenants = await tx.execute(sql`
      SELECT t.id, t.display_name, t.legal_name,
             (SELECT u.id FROM users u
              WHERE u.tenant_id = t.id
                AND 'owner' = ANY(u.roles)
                AND u.status = 'active'
              ORDER BY u.created_at ASC LIMIT 1) AS owner_id
      FROM tenants t
      WHERE t.status IN ('active', 'trial')
    `);

    const summary: Array<Record<string, unknown>> = [];
    for (const row of tenants.rows as Array<{
      id: string;
      display_name: string | null;
      legal_name: string | null;
      owner_id: string | null;
    }>) {
      const tenantId = row.id;
      const displayName = row.display_name ?? row.legal_name ?? tenantId;
      const ownerId = row.owner_id;
      if (!ownerId) {
        console.warn(`[backfill] tenant ${displayName} has no active owner — skipping`);
        summary.push({ tenant: displayName, status: "no-owner" });
        continue;
      }
      try {
        const r = await installDefaultRecipes(tx, tenantId, ownerId);
        console.log(
          `[backfill] ${displayName}: installed=${r.installed.length} skipped=${r.skipped.length}`
        );
        summary.push({
          tenant: displayName,
          installed: r.installed.length,
          skipped: r.skipped.length,
        });
      } catch (err) {
        console.error(`[backfill] ${displayName} failed:`, err);
        summary.push({ tenant: displayName, status: "failed", error: String(err) });
      }
    }
    return summary;
  });

  console.log("\n[backfill] summary:");
  console.table(result);
  process.exit(0);
}

main().catch((err) => {
  console.error("[backfill] fatal:", err);
  process.exit(1);
});
