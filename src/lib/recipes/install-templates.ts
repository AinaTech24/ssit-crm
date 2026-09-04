/**
 * Install a recipe's `defaultTemplates` as real, sendable templates.
 *
 * dispatch() resolves a send by (tenant, key, channel, locale) and refuses
 * anything whose `templates.status` is not "approved" — so a recipe that ships
 * ON needs its bodies present and approved, or every one of its sends is
 * recorded as `skipped_template_not_approved`.
 *
 * These are the platform's own default bodies, already written to satisfy the
 * compliance gate; the gate still runs on every individual send, so approving
 * them here does not bypass any check that matters at send time. A firm can
 * edit or re-version them afterwards like any other template.
 *
 * Idempotent: an existing (key, channel, locale) row for the tenant is left
 * exactly as it is, so a firm's edits are never overwritten by a re-run.
 */

import { v4 as uuid } from "uuid";
import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { templates, templateVersions } from "@/db/schema";
import type { RecipeDef } from ".";

const LOCALE = "en-IN";

export async function installRecipeTemplates(
  tx: Tx,
  tenantId: string,
  recipe: RecipeDef,
  createdByUserId: string | null
): Promise<string[]> {
  const defs = recipe.defaultTemplates ?? [];
  const created: string[] = [];

  for (const def of defs) {
    const [existing] = await tx
      .select({ id: templates.id })
      .from(templates)
      .where(
        and(
          eq(templates.tenantId, tenantId),
          eq(templates.key, def.key),
          eq(templates.channel, def.channel as any),
          eq(templates.locale, LOCALE)
        )
      )
      .limit(1);
    if (existing) continue;

    const templateId = uuid();
    const versionId = uuid();

    await tx.insert(templates).values({
      id: templateId,
      tenantId,
      key: def.key,
      channel: def.channel as any,
      name: def.name,
      description: `Shipped with the "${recipe.name}" automation.`,
      category: (def.category ?? "transactional") as any,
      locale: LOCALE,
      currentVersionId: versionId,
      status: "approved",
    } as any);

    await tx.insert(templateVersions).values({
      id: versionId,
      templateId,
      tenantId,
      versionNumber: 1,
      body: def.body as any,
      variables: (def.variables ?? []) as any,
      attachments: [] as any,
      createdByUserId,
      // Internal approval only. A WhatsApp body still needs its Meta-approved
      // template registered with the provider before it can open a new
      // conversation — until then WA sends outside the 24h session window are
      // recorded as skipped, which is the correct behaviour.
      approvalStatus: "approved_internal",
      approvedByUserId: createdByUserId,
      approvedAt: new Date(),
    } as any);

    created.push(`${def.key} (${def.channel})`);
  }

  return created;
}
