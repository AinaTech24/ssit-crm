/**
 * sync-recipes — upsert ONLY the global automation recipe library into the
 * `recipes` table. Surgical counterpart to seed-prod.ts: it touches nothing
 * else (no packages, no admin, no demo data), so it's safe to run on prod to
 * publish newly-added recipes.
 *
 *   ALLOW_SYSTEM_TX=1 npx tsx scripts/sync-recipes.ts
 *
 * Idempotent — ON CONFLICT (key) DO UPDATE.
 */

import "dotenv/config";
import { sql } from "drizzle-orm";
import { withSystem } from "../src/db/client";
import { ALL_RECIPES } from "../src/lib/recipes";

async function main() {
  console.log(`Syncing ${ALL_RECIPES.length} recipes…`);
  await withSystem(async (tx) => {
    for (const r of ALL_RECIPES) {
      await tx.execute(sql`
        INSERT INTO recipes (id, key, name, description, category, graph, tags, created_at, updated_at)
        VALUES (
          gen_random_uuid(), ${r.key}, ${r.name}, ${r.description}, ${r.category},
          ${JSON.stringify(r.graph)}::jsonb, ${JSON.stringify(r.tags ?? [])}::jsonb,
          now(), now()
        )
        ON CONFLICT (key) DO UPDATE
        SET name = EXCLUDED.name, description = EXCLUDED.description, category = EXCLUDED.category,
            graph = EXCLUDED.graph, tags = EXCLUDED.tags, updated_at = now()
      `);
    }
  });
  console.log(`✓ ${ALL_RECIPES.length} recipes synced`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("sync-recipes failed:", e);
    process.exit(1);
  });
