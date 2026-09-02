/**
 * Ensure the per-tenant "share_asset" comms template exists for a channel.
 * Extracted from the 1:1 content send so the bulk send can reuse it (create
 * once, then dispatch per recipient). Throws a 422-shaped error if the static
 * template body fails the compliance checker.
 */
import { v4 as uuid } from "uuid";
import { and, eq } from "drizzle-orm";
import { runComplianceChecks } from "@/lib/comms/compliance";
import { templates, templateVersions, tenants } from "@/db/schema";

type Tx = any;

export async function ensureShareTemplate(tx: Tx, tenantId: string, channel: "email" | "whatsapp") {
  const existing = (
    await tx
      .select()
      .from(templates)
      .where(and(eq(templates.tenantId, tenantId), eq(templates.key, "share_asset"), eq(templates.channel, channel)))
      .limit(1)
  )[0];
  if (existing) return existing;

  const tplId = uuid();
  const verId = uuid();
  const templateBody =
    channel === "email"
      ? {
          subject: "Shared Update: {{asset_title}}",
          blocks: [
            { type: "text", text: "Hi {{name}},\n\n{{custom_note}}\n\nYou can view/download the update here:\n{{asset_url}}\n\nBest regards,\n{{tenant_display_name}}" },
          ],
        }
      : { vartifyTemplateName: "share_asset", text: "Hi {{name}}, here is the asset: {{asset_title}} ({{asset_url}})." };

  const templateVariables =
    channel === "email"
      ? [
          { key: "name", type: "string" },
          { key: "custom_note", type: "string" },
          { key: "asset_title", type: "string" },
          { key: "asset_url", type: "url" },
          { key: "tenant_display_name", type: "string" },
        ]
      : [
          { key: "name", type: "string" },
          { key: "asset_title", type: "string" },
          { key: "asset_url", type: "url" },
        ];

  const scanText =
    channel === "email"
      ? `${(templateBody as any).subject ?? ""} ${(templateBody as any).blocks?.[0]?.text ?? ""}`
      : (templateBody as any).text ?? "";
  const tn = (await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1))[0];
  const compliance = runComplianceChecks({
    channel,
    category: "utility",
    tenant: { legalName: (tn as any)?.legalName, arn: (tn as any)?.arn, principalEuin: (tn as any)?.principalEuin ?? undefined, riaRegistered: (tn as any)?.riaRegistered ?? false },
    text: scanText,
  });
  if (compliance.blocked) {
    throw Object.assign(new Error("Share template failed compliance"), { status: 422, findings: compliance.findings });
  }

  await tx.insert(templates).values({
    id: tplId,
    tenantId,
    key: "share_asset",
    channel,
    name: channel === "email" ? "Share Content Asset (Email)" : "Share Content Asset (WhatsApp)",
    description: "System template for sharing content library assets",
    category: "utility",
    status: channel === "email" ? "approved" : "pending_approval",
    currentVersionId: verId,
  } as any);
  await tx.insert(templateVersions).values({
    id: verId,
    templateId: tplId,
    tenantId,
    versionNumber: 1,
    body: templateBody,
    variables: templateVariables,
    approvalStatus: channel === "email" ? "approved_internal" : "draft",
    complianceScore: String(compliance.score),
  } as any);

  return (
    await tx
      .select()
      .from(templates)
      .where(and(eq(templates.tenantId, tenantId), eq(templates.key, "share_asset"), eq(templates.channel, channel)))
      .limit(1)
  )[0];
}
