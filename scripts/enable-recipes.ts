/**
 * Publish + enable the pre-installed default recipes so automation actually
 * fires. The curated recipes are installed DISABLED (enabled:false, version
 * status 'draft') for owner review — until each is published they never run.
 * This is the #1 "why didn't anything fire?" trap. This script does the
 * one-time publish across tenants (the same steps the publish API performs):
 * draft → published, point current_version_id, enable, and materialize the
 * trigger rows the outbox poller / scheduler read.
 *
 * Idempotent — a recipe with no remaining draft is skipped.
 *
 * Usage:
 *   npx tsx scripts/enable-recipes.ts                     all tenants, all installed recipes
 *   npx tsx scripts/enable-recipes.ts --tenant <id>       one tenant
 *   npx tsx scripts/enable-recipes.ts --only birthday,sip_rejection_followup
 *   npx tsx scripts/enable-recipes.ts --dry              report, don't change
 */

import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

process.env.ALLOW_SYSTEM_TX = process.env.ALLOW_SYSTEM_TX ?? "1";

import { withSystem, withTenant } from "../src/db/client";
import { workflows, workflowVersions } from "../src/db/schema";
import { materializeTriggers } from "../src/lib/workflow/triggers";

const DRY = process.argv.includes("--dry");
function argVal(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}
const ONLY = (argVal("--only") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const ONE_TENANT = argVal("--tenant");

async function main() {
  const tenants = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT t.id,
             COALESCE(t.display_name, t.legal_name, t.id::text) AS name,
             (SELECT u.id FROM users u
               WHERE u.tenant_id = t.id AND 'owner' = ANY(u.roles) AND u.status = 'active'
               ORDER BY u.created_at ASC LIMIT 1) AS owner_id
      FROM tenants t
      WHERE t.status IN ('active','trial') ${ONE_TENANT ? sql`AND t.id = ${ONE_TENANT}::uuid` : sql``}
    `);
    return r.rows as Array<{ id: string; name: string; owner_id: string | null }>;
  });

  let totalPublished = 0;
  for (const t of tenants) {
    if (!t.owner_id) {
      console.warn(`[enable-recipes] ${t.name}: no active owner — skipping`);
      continue;
    }
    const published = await withTenant(
      t.id,
      async (tx) => {
        // Installed recipes (recipe_key set) that still have a draft version.
        const rows = await tx
          .select({ wfId: workflows.id, key: workflows.recipeKey, vId: workflowVersions.id, graph: workflowVersions.graph })
          .from(workflows)
          .innerJoin(
            workflowVersions,
            and(eq(workflowVersions.workflowId, workflows.id), eq(workflowVersions.status, "draft"))
          )
          .where(eq(workflows.tenantId, t.id));

        const targets = rows.filter(
          (r) => r.key != null && (ONLY.length === 0 || ONLY.includes(r.key))
        );
        if (DRY) {
          for (const r of targets) console.log(`[enable-recipes] (dry) ${t.name}: would publish ${r.key}`);
          return targets.length;
        }

        for (const r of targets) {
          await tx
            .update(workflowVersions)
            .set({ status: "archived" } as any)
            .where(and(eq(workflowVersions.workflowId, r.wfId), eq(workflowVersions.status, "published")));
          await tx
            .update(workflowVersions)
            .set({ status: "published", publishedAt: new Date(), publishedBy: t.owner_id } as any)
            .where(eq(workflowVersions.id, r.vId));
          await tx
            .update(workflows)
            .set({ currentVersionId: r.vId, enabled: true, pausedAt: null, pausedReason: null } as any)
            .where(eq(workflows.id, r.wfId));
          await materializeTriggers(tx, {
            tenantId: t.id,
            workflowId: r.wfId,
            graph: r.graph,
            enabled: true,
          });
          console.log(`[enable-recipes] ${t.name}: published + enabled ${r.key}`);
        }
        return targets.length;
      },
      { userId: t.owner_id }
    );
    totalPublished += published;
  }

  console.log(
    `\n[enable-recipes] ${DRY ? "(dry) would publish" : "published"} ${totalPublished} recipe(s) across ${tenants.length} tenant(s).`
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("[enable-recipes] failed:", e?.message ?? e);
  process.exit(1);
});
