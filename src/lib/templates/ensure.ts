/**
 * ensureStarterTemplate — provision a starter template into a tenant if it
 * doesn't already exist. Idempotent by (tenant, key, channel, locale). Creates
 * the template + version 1 and marks it approved (these are vendor-provided,
 * compliance-reviewed defaults; the 11-rule compliance gate still runs on every
 * send). Runs inside an existing tenant transaction.
 */

import { v4 as uuid } from "uuid";
import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { templates, templateVersions } from "@/db/schema";
import { getStarterTemplate } from "./starters";

const LOCALE = "en-IN";

export async function ensureStarterTemplate(
  tx: Tx,
  tenantId: string,
  userId: string,
  key: string
): Promise<{ created: boolean; key: string } | null> {
  const starter = getStarterTemplate(key);
  if (!starter) return null;

  const existing = await tx
    .select({ id: templates.id })
    .from(templates)
    .where(
      and(
        eq(templates.tenantId, tenantId),
        eq(templates.key, starter.key),
        eq(templates.channel, starter.channel),
        eq(templates.locale, LOCALE)
      )
    )
    .limit(1);
  if (existing.length) return { created: false, key: starter.key };

  const templateId = uuid();
  const versionId = uuid();

  await tx.insert(templates).values({
    id: templateId,
    tenantId,
    key: starter.key,
    channel: starter.channel,
    name: starter.name,
    description: starter.description ?? null,
    category: starter.category,
    locale: LOCALE,
    status: "approved",
  } as any);

  await tx.insert(templateVersions).values({
    id: versionId,
    templateId,
    tenantId,
    versionNumber: 1,
    body: starter.body as any,
    variables: starter.variables as any,
    approvalStatus: "approved_internal",
    createdByUserId: userId,
    approvedByUserId: userId,
    approvedAt: new Date(),
  } as any);

  await tx.update(templates).set({ currentVersionId: versionId }).where(eq(templates.id, templateId));

  return { created: true, key: starter.key };
}
