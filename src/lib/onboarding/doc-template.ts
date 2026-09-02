/**
 * ensureDocCollectionTemplate — self-provision a Meta-approved WhatsApp template
 * for document-collection requests, so the one-click "Send Doc Checklist" can
 * deliver on WhatsApp proactively (outside the 24h window — only templates can).
 *
 * Idempotent: the first call creates a draft + submits it to Meta via Vartify;
 * later calls return the existing template. Once Meta approves it (the
 * vartify-template-sync worker promotes pending_approval → approved), the send path
 * picks it up automatically. Best-effort — never throws.
 */

import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { templates, templateVersions } from "@/db/schema";
import { buildMetaSubmission } from "@/lib/comms/whatsapp-template-submit";
import { vartifyWhatsappAdapter } from "@/lib/comms/adapters/vartify";
import { getTenantIntegration } from "@/lib/comms/integrations";
import { whatsappProviderId } from "@/lib/comms/adapters/whatsapp";

export const DOC_TEMPLATE_KEY = "document_collection";

const DOC_BODY = {
  body: {
    text:
      "Hello {{client.name}}, to complete your account setup please upload your KYC documents using this secure link: {{doc.link}}\n\n" +
      "Required: PAN, Aadhaar, passport-size photo, recent bank statement, cancelled cheque.",
  },
};
const DOC_VARIABLES = [
  { key: "client.name", label: "Client name", example: "Rajesh Kumar" },
  { key: "doc.link", label: "Upload link", example: "https://crm.ssit.com/u/abc123" },
];

export type EnsureResult = { key: string; status: string; submitted?: boolean; error?: string };

export async function ensureDocCollectionTemplate(tenantId: string, userId: string): Promise<EnsureResult> {
  try {
    // 1. Already have a document/KYC WhatsApp template?
    const existing = await withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select({ key: templates.key, name: templates.name, status: templates.status })
        .from(templates)
        .where(and(eq(templates.tenantId, tenantId), eq(templates.channel as any, "whatsapp" as any)));
      return rows.find((r) => /doc|kyc|onboard|document|collect|upload|checklist/i.test(`${r.key} ${r.name}`)) ?? null;
    });
    if (existing) return { key: existing.key, status: existing.status };

    // 2. Create the draft (guarded against a concurrent create).
    const created = await withTenant(tenantId, async (tx) => {
      const dup = await tx
        .select({ id: templates.id })
        .from(templates)
        .where(and(eq(templates.tenantId, tenantId), eq(templates.key, DOC_TEMPLATE_KEY)))
        .limit(1);
      if (dup.length) return null;
      const tplId = randomUUID();
      const verId = randomUUID();
      await tx.insert(templates).values({
        id: tplId, tenantId, key: DOC_TEMPLATE_KEY, channel: "whatsapp",
        name: "Document Collection", description: "KYC document upload request",
        category: "utility", locale: "en", status: "draft", currentVersionId: verId,
      } as any);
      await tx.insert(templateVersions).values({
        id: verId, templateId: tplId, tenantId, versionNumber: 1,
        body: DOC_BODY, variables: DOC_VARIABLES, attachments: [],
        approvalStatus: "draft", createdByUserId: userId,
      } as any);
      return { tplId, verId };
    });
    if (!created) return { key: DOC_TEMPLATE_KEY, status: "draft" };

    // 3. Submit to Meta via Vartify.
    const integ = await withTenant(tenantId, async (tx) => getTenantIntegration(tx, tenantId, whatsappProviderId));
    const apiKey = (integ?.config as any)?.apiKey as string | undefined;
    const baseUrl = (integ?.config as any)?.webhookUrl as string | undefined;
    if (!apiKey) return { key: DOC_TEMPLATE_KEY, status: "draft", submitted: false, error: "WhatsApp not connected" };

    const sub = buildMetaSubmission(
      { key: DOC_TEMPLATE_KEY, name: "Document Collection", category: "utility", locale: "en" } as any,
      { body: DOC_BODY, variables: DOC_VARIABLES } as any
    );
    const result = await vartifyWhatsappAdapter.submitTemplate({ apiKey, baseUrl, ...sub });
    if (result.ok) {
      await withTenant(tenantId, async (tx) => {
        await tx.update(templateVersions).set({
          approvalStatus: "submitted",
          externalRef: result.metaTemplateId ?? sub.templateName,
          externalStatus: "PENDING",
          externalSyncedAt: new Date(),
        } as any).where(eq(templateVersions.id, created.verId));
        await tx.update(templates).set({ status: "pending_approval" } as any).where(eq(templates.id, created.tplId));
      });
      return { key: DOC_TEMPLATE_KEY, status: "pending_approval", submitted: true };
    }
    return { key: DOC_TEMPLATE_KEY, status: "draft", submitted: false, error: result.error };
  } catch (e: any) {
    return { key: DOC_TEMPLATE_KEY, status: "error", submitted: false, error: String(e?.message ?? e) };
  }
}
