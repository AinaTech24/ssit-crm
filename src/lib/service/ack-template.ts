/**
 * The WhatsApp template behind the "we've received your request" acknowledgement.
 *
 * Why a template: the acknowledgement is PROACTIVE (the client has not just messaged
 * us), and outside Meta's 24-hour window only an approved template can reach them.
 * Without one every acknowledgement is skipped. Same self-provisioning approach as
 * `ensureDocCollectionTemplate` / `ensureClientFormTemplate`: the first call creates
 * a draft and submits it to Meta through Vartify, later calls return what exists, and
 * the vartify-template-sync worker promotes it to approved. Best-effort — never throws.
 */

import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { templates, templateVersions } from "@/db/schema";
import { buildMetaSubmission } from "@/lib/comms/whatsapp-template-submit";
import { vartifyWhatsappAdapter } from "@/lib/comms/adapters/vartify";
import { getTenantIntegration } from "@/lib/comms/integrations";
import { whatsappProviderId } from "@/lib/comms/adapters/whatsapp";

export const SR_ACK_TEMPLATE_KEY = "service_request_received";

const BODY = {
  body: {
    text:
      "Hello {{client.name}}, we have received your request (ref {{sr.ticket}}). " +
      "Our team will get back to you by {{sr.eta}}. Thank you for banking your trust with us. — {{firm.name}}",
  },
};

const VARIABLES: Array<{ key: string; type: "string"; label: string; example: string }> = [
  { key: "client.name", type: "string", label: "Client name", example: "Rajesh Kumar" },
  { key: "sr.ticket", type: "string", label: "Request reference", example: "SR-2026-00023" },
  { key: "sr.eta", type: "string", label: "Promised date", example: "09 Nov 2026" },
  { key: "firm.name", type: "string", label: "Firm name", example: "SSIT Finserv" },
];

/** Same matcher the send path uses, so a firm's own equivalent template is reused. */
export const SR_ACK_MATCHER = /service.?request|request.?(received|ack)|ticket/i;

export type SrAckValues = { name: string; ticket: string; eta: string; firm: string };

/**
 * Fill whatever variables a template declares. Our own template uses exact keys; a
 * firm-authored one may name them differently, so match by meaning, not by name.
 */
export function mapAckVariables(keys: string[], v: SrAckValues): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    if (/ticket|ref|sr[._]?(no|id|number)|request/i.test(k)) out[k] = v.ticket;
    else if (/eta|date|by|resolution|due/i.test(k)) out[k] = v.eta;
    else if (/firm|company|tenant|business|advisor|distributor/i.test(k)) out[k] = v.firm;
    else if (/name|client|investor/i.test(k)) out[k] = v.name;
  }
  return out;
}

export type EnsureResult = { key: string; status: string; submitted?: boolean; error?: string };

export async function ensureServiceAckTemplate(tenantId: string, userId?: string | null): Promise<EnsureResult> {
  try {
    const existing = await withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select({ key: templates.key, name: templates.name, status: templates.status })
        .from(templates)
        .where(and(eq(templates.tenantId, tenantId), eq(templates.channel, "whatsapp")));
      return rows.find((r) => SR_ACK_MATCHER.test(`${r.key} ${r.name}`)) ?? null;
    });
    if (existing) return { key: existing.key, status: existing.status };

    const created = await withTenant(tenantId, async (tx) => {
      const dup = await tx
        .select({ id: templates.id })
        .from(templates)
        .where(and(eq(templates.tenantId, tenantId), eq(templates.key, SR_ACK_TEMPLATE_KEY)))
        .limit(1);
      if (dup.length) return null;
      const tplId = randomUUID();
      const verId = randomUUID();
      await tx.insert(templates).values({
        id: tplId, tenantId, key: SR_ACK_TEMPLATE_KEY, channel: "whatsapp",
        name: "Service request received", description: "Acknowledges a new service request to the client",
        category: "utility", locale: "en", status: "draft", currentVersionId: verId,
      });
      await tx.insert(templateVersions).values({
        id: verId, templateId: tplId, tenantId, versionNumber: 1,
        body: BODY, variables: VARIABLES, attachments: [],
        approvalStatus: "draft", createdByUserId: userId ?? null,
      });
      return { tplId, verId };
    });
    if (!created) return { key: SR_ACK_TEMPLATE_KEY, status: "draft" };

    const integ = await withTenant(tenantId, async (tx) => getTenantIntegration(tx, tenantId, whatsappProviderId));
    const apiKey = integ?.config?.apiKey as string | undefined;
    const baseUrl = integ?.config?.webhookUrl as string | undefined;
    if (!apiKey) return { key: SR_ACK_TEMPLATE_KEY, status: "draft", submitted: false, error: "WhatsApp not connected" };

    const sub = buildMetaSubmission(
      { key: SR_ACK_TEMPLATE_KEY, name: "Service request received", category: "utility", locale: "en" } as any,
      { body: BODY, variables: VARIABLES } as any
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
      return { key: SR_ACK_TEMPLATE_KEY, status: "pending_approval", submitted: true };
    }
    return { key: SR_ACK_TEMPLATE_KEY, status: "draft", submitted: false, error: result.error };
  } catch (e: any) {
    return { key: SR_ACK_TEMPLATE_KEY, status: "error", submitted: false, error: String(e?.message ?? e) };
  }
}
