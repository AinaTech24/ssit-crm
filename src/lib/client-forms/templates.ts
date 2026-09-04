/**
 * ensureClientFormTemplate — self-provision a Meta-approved WhatsApp template
 * per client-form kind, so /api/client-forms/send can deliver PROACTIVELY.
 *
 * Why this exists: outside Meta's 24h session window, only an approved template
 * can reach a client. Without one, every proactive send comes back
 * `skipped_session` and the RM is pushed to the wa.me fallback — which works,
 * but means sending by hand, one client at a time. Provisioning the template
 * once turns that into automatic delivery.
 *
 * Generalises src/lib/onboarding/doc-template.ts (document_collection) to the
 * risk-profile / discovery / portfolio forms. Idempotent: the first call creates
 * a draft and submits it to Meta via Vartify; later calls return what exists. The
 * vartify-template-sync worker promotes pending_approval → approved, after which
 * the send path picks it up with no code change. Best-effort — never throws.
 */

import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { templates, templateVersions } from "@/db/schema";
import { buildMetaSubmission } from "@/lib/comms/whatsapp-template-submit";
import { vartifyWhatsappAdapter } from "@/lib/comms/adapters/vartify";
import { getTenantIntegration } from "@/lib/comms/integrations";
import { whatsappProviderId } from "@/lib/comms/adapters/whatsapp";

export type ClientFormKind = "risk_profile" | "financial_discovery" | "portfolio_view";

export type EnsureResult = { key: string; status: string; submitted?: boolean; error?: string };

/** Per-kind template definition. Body text mirrors what the RM would say. */
const SPECS: Record<ClientFormKind, {
  key: string;
  name: string;
  description: string;
  category: "utility" | "marketing";
  /** Must match the send path's template-picker regex for this kind. */
  bodyText: string;
  linkLabel: string;
  linkExample: string;
}> = {
  risk_profile: {
    key: "risk_profile_request",
    name: "Risk Profile Request",
    description: "Ask a client to complete the risk questionnaire",
    category: "utility",
    bodyText:
      "Hello {{client.name}}, before we recommend anything we need your risk profile on record. " +
      "It takes about 3 minutes: {{form.link}}",
    linkLabel: "Risk profile link",
    linkExample: "https://crm.equitywala.com/r/abc123",
  },
  financial_discovery: {
    key: "financial_discovery_request",
    name: "Financial Health Check",
    description: "Short fact-find before a review meeting",
    category: "utility",
    bodyText:
      "Hello {{client.name}}, a few quick questions before we meet, so our time is about you and not paperwork: {{form.link}}",
    linkLabel: "Health check link",
    linkExample: "https://crm.equitywala.com/fd/abc123",
  },
  portfolio_view: {
    key: "portfolio_view_link",
    name: "Portfolio Link",
    description: "Login-free read-only portfolio view",
    category: "utility",
    bodyText:
      "Hello {{client.name}}, here is your live portfolio view — secure and read-only, no login needed: {{form.link}}",
    linkLabel: "Portfolio link",
    linkExample: "https://crm.equitywala.com/portfolio/abc123",
  },
};

/** Same matcher the send path uses, so we never double-provision. */
const MATCHERS: Record<ClientFormKind, RegExp> = {
  risk_profile: /risk|profile|suitab/i,
  financial_discovery: /discovery|health|fact.?find/i,
  portfolio_view: /portfolio|holding|statement/i,
};

export async function ensureClientFormTemplate(
  kind: ClientFormKind,
  tenantId: string,
  userId: string
): Promise<EnsureResult> {
  const spec = SPECS[kind];
  if (!spec) return { key: String(kind), status: "unsupported" };

  try {
    // 1. Does a matching WhatsApp template already exist?
    const existing = await withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select({ key: templates.key, name: templates.name, status: templates.status })
        .from(templates)
        .where(and(eq(templates.tenantId, tenantId), eq(templates.channel as any, "whatsapp" as any)));
      return rows.find((r) => MATCHERS[kind].test(`${r.key} ${r.name}`)) ?? null;
    });
    if (existing) return { key: existing.key, status: existing.status };

    const body = { body: { text: spec.bodyText } };
    const variables = [
      { key: "client.name", label: "Client name", example: "Rajesh Kumar" },
      { key: "form.link", label: spec.linkLabel, example: spec.linkExample },
    ];

    // 2. Create the draft, guarded against a concurrent create.
    const created = await withTenant(tenantId, async (tx) => {
      const dup = await tx
        .select({ id: templates.id })
        .from(templates)
        .where(and(eq(templates.tenantId, tenantId), eq(templates.key, spec.key)))
        .limit(1);
      if (dup.length) return null;
      const tplId = randomUUID();
      const verId = randomUUID();
      await tx.insert(templates).values({
        id: tplId, tenantId, key: spec.key, channel: "whatsapp",
        name: spec.name, description: spec.description,
        category: spec.category, locale: "en", status: "draft", currentVersionId: verId,
      } as any);
      await tx.insert(templateVersions).values({
        id: verId, templateId: tplId, tenantId, versionNumber: 1,
        body, variables, attachments: [],
        approvalStatus: "draft", createdByUserId: userId,
      } as any);
      return { tplId, verId };
    });
    if (!created) return { key: spec.key, status: "draft" };

    // 3. Submit to Meta via Vartify. No integration → the draft simply waits.
    const integ = await withTenant(tenantId, async (tx) => getTenantIntegration(tx, tenantId, whatsappProviderId));
    const apiKey = (integ?.config as any)?.apiKey as string | undefined;
    const baseUrl = (integ?.config as any)?.webhookUrl as string | undefined;
    if (!apiKey) return { key: spec.key, status: "draft", submitted: false, error: "WhatsApp not connected" };

    const sub = buildMetaSubmission(
      { key: spec.key, name: spec.name, category: spec.category, locale: "en" } as any,
      { body, variables } as any
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
      return { key: spec.key, status: "pending_approval", submitted: true };
    }
    return { key: spec.key, status: "draft", submitted: false, error: result.error };
  } catch (e: any) {
    return { key: spec.key, status: "error", submitted: false, error: String(e?.message ?? e) };
  }
}
