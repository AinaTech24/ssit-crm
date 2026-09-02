/**
 * `installDefaultRecipes(tenantId, ownerUserId)` — wires the curated
 * "every MFD should have these" recipes as workflow rows on a fresh
 * tenant. Called from the signup flow + super-admin tenant create.
 *
 * The workflows land DISABLED (`enabled: false`) so the owner reviews
 * each one and turns it on. This matches Zoho / HubSpot patterns —
 * presets are visible immediately, ownership is explicit.
 *
 * Why a curated subset and not ALL_RECIPES: a brand-new MFD turning on
 * 24 workflows at once is noisy and confusing. The list below is the
 * 9 most universally useful (per the MFD ops checklist). The other 15+
 * recipes are still available via the library at /dashboard/workflows.
 *
 * Idempotent: skips any recipe key already installed for the tenant.
 */

import { v4 as uuid } from "uuid";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { workflows, workflowVersions } from "@/db/schema";
import { ALL_RECIPES } from ".";

/** The 9 recipes every MFD gets pre-installed on signup. */
const DEFAULT_RECIPE_KEYS = [
  // Daily / weekly digests — owner stays informed
  "daily_mis_digest",
  "task_weekly_owner_report",
  // Compliance / regulatory cadence
  "kyc_expiry_renew",
  "nominee_missing",
  "nism_expiry_alert",
  "arn_expiry_alert",
  // Engagement
  "birthday_touchpoint",
  "investor_anniversary",
  // Operations safety net
  "sip_rejection_followup",
];

export async function installDefaultRecipes(
  tx: Tx,
  tenantId: string,
  ownerUserId: string
): Promise<{ installed: string[]; skipped: string[] }> {
  const installed: string[] = [];
  const skipped: string[] = [];

  // Find any recipe keys already installed for this tenant (idempotency).
  const existingRows = await tx.execute(sql`
    SELECT recipe_key FROM workflows
    WHERE tenant_id = ${tenantId}::uuid
      AND recipe_key = ANY(ARRAY[${sql.join(
        DEFAULT_RECIPE_KEYS.map((k) => sql`${k}`),
        sql`, `
      )}]::text[])
  `);
  const have = new Set(
    (existingRows.rows as Array<{ recipe_key: string }>).map((r) => r.recipe_key)
  );

  for (const key of DEFAULT_RECIPE_KEYS) {
    if (have.has(key)) {
      skipped.push(key);
      continue;
    }
    const recipe = ALL_RECIPES.find((r) => r.key === key);
    if (!recipe) {
      console.warn(`[install-defaults] recipe ${key} missing from ALL_RECIPES`);
      continue;
    }
    const wfId = uuid();
    const versionId = uuid();
    await tx.insert(workflows).values({
      id: wfId,
      tenantId,
      name: recipe.name,
      description: recipe.description,
      category: recipe.category,
      recipeKey: recipe.key,
      enabled: false, // owner reviews + turns on
      currentVersionId: versionId,
      createdBy: ownerUserId,
    } as any);
    await tx.insert(workflowVersions).values({
      id: versionId,
      workflowId: wfId,
      tenantId,
      versionNumber: 1,
      status: "draft",
      graph: recipe.graph,
    } as any);
    installed.push(key);
  }

  return { installed, skipped };
}
