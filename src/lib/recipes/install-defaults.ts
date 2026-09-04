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
import { materializeTriggers, upsertTrigger } from "@/lib/workflow/triggers";
import { installRecipeTemplates } from "./install-templates";

/** The recipes every MFD gets pre-installed on signup. */
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
  // Every new lead gets a welcome WhatsApp + email the moment it is created
  // (and the referrer a thank-you when there is one).
  "lead_welcome",
  // Operations safety net
  "sip_rejection_followup",
];

/**
 * Recipes that ship ON — published, enabled, and with their event trigger
 * materialized — rather than as a draft for the owner to review.
 *
 * Only the new-lead welcome qualifies: the firm expects a lead entered in the
 * CRM to get its WhatsApp + email immediately, with no setup step. Every send
 * still passes the consent check and the compliance gate in dispatch(), so a
 * lead with no consent on file is recorded as skipped rather than messaged.
 */
const AUTO_ENABLED_RECIPE_KEYS = new Set<string>(["lead_welcome"]);

export async function installDefaultRecipes(
  tx: Tx,
  tenantId: string,
  ownerUserId: string
): Promise<{ installed: string[]; skipped: string[] }> {
  const installed: string[] = [];
  const skipped: string[] = [];

  // Find any recipe keys already installed for this tenant (idempotency).
  const existingRows = await tx.execute(sql`
    SELECT id, recipe_key, enabled, current_version_id FROM workflows
    WHERE tenant_id = ${tenantId}::uuid
      AND recipe_key = ANY(ARRAY[${sql.join(
        DEFAULT_RECIPE_KEYS.map((k) => sql`${k}`),
        sql`, `
      )}]::text[])
  `);
  type ExistingRow = { id: string; recipe_key: string; enabled: boolean; current_version_id: string | null };
  const existing = new Map<string, ExistingRow>(
    (existingRows.rows as ExistingRow[]).map((r) => [r.recipe_key, r])
  );

  for (const key of DEFAULT_RECIPE_KEYS) {
    const recipe = ALL_RECIPES.find((r) => r.key === key);
    if (!recipe) {
      console.warn(`[install-defaults] recipe ${key} missing from ALL_RECIPES`);
      continue;
    }
    const prior = existing.get(key);
    if (prior) {
      // Already installed. Auto-enabled recipes are REPAIRED rather than
      // skipped: a tenant that got this recipe before it was auto-on (or
      // before its trigger node declared an event) would otherwise sit with a
      // disabled, trigger-less workflow that can never fire.
      if (AUTO_ENABLED_RECIPE_KEYS.has(key)) {
        await tx.execute(sql`
          UPDATE workflows SET enabled = true, updated_at = now()
           WHERE id = ${prior.id}::uuid AND tenant_id = ${tenantId}::uuid`);
        if (prior.current_version_id) {
          await tx.execute(sql`
            UPDATE workflow_versions SET status = 'published', graph = ${JSON.stringify(recipe.graph)}::jsonb
             WHERE id = ${prior.current_version_id}::uuid AND tenant_id = ${tenantId}::uuid`);
        }
        await upsertTrigger(tx, {
          tenantId,
          workflowId: prior.id,
          graph: recipe.graph,
          enabled: true,
        });
        await installRecipeTemplates(tx, tenantId, recipe, ownerUserId);
        installed.push(key);
        continue;
      }
      skipped.push(key);
      continue;
    }
    const wfId = uuid();
    const versionId = uuid();
    const autoOn = AUTO_ENABLED_RECIPE_KEYS.has(key);
    await tx.insert(workflows).values({
      id: wfId,
      tenantId,
      name: recipe.name,
      description: recipe.description,
      category: recipe.category,
      recipeKey: recipe.key,
      enabled: autoOn, // the rest are drafts the owner reviews + turns on
      currentVersionId: versionId,
      createdBy: ownerUserId,
    } as any);
    await tx.insert(workflowVersions).values({
      id: versionId,
      workflowId: wfId,
      tenantId,
      versionNumber: 1,
      status: autoOn ? "published" : "draft",
      graph: recipe.graph,
    } as any);
    // Without a workflow_triggers row nothing subscribes to the event, so an
    // enabled workflow would still never fire.
    if (autoOn) {
      await materializeTriggers(tx, {
        tenantId,
        workflowId: wfId,
        graph: recipe.graph,
        enabled: true,
      });
      // The send actions resolve templates by key — without the bodies every
      // send would be skipped as "template_not_approved".
      await installRecipeTemplates(tx, tenantId, recipe, ownerUserId);
    }
    installed.push(key);
  }

  return { installed, skipped };
}
