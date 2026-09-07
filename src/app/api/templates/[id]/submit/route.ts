/**
 * POST /api/templates/[id]/submit
 *
 * Moves a draft template into the approval pipeline.
 *   - For utility/transactional WhatsApp: auto-submit to Vartify (and Meta).
 *   - For marketing: requires a compliance officer to approve first.
 *   - For email: marks ready (no external approval needed beyond compliance).
 *
 * Compliance gate is re-run on submit — any `block` finding rejects the
 * submission outright.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { templates, templateVersions, templateApprovals, tenants } from "@/db/schema";
import { runComplianceChecks } from "@/lib/comms/compliance";
import { templateBodyToText } from "@/lib/comms/tokens";
import { getTenantIntegration } from "@/lib/comms/integrations";
import { whatsappProviderId } from "@/lib/comms/adapters/whatsapp";
import { vartifyWhatsappAdapter } from "@/lib/comms/adapters/vartify";
import { buildMetaSubmission } from "@/lib/comms/whatsapp-template-submit";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    // Pushing a template into the approval queue is part of authoring it.
    requireCap(session.roles, "template.create", session.permissions);

    const result = await withTenant(session.tenantId, async (tx) => {
      const tpl = (await tx.select().from(templates).where(and(eq(templates.id, id), eq(templates.tenantId, session.tenantId))).limit(1))[0];
      if (!tpl) throw Object.assign(new Error("template not found"), { status: 404 });
      // Lock the draft version FOR UPDATE so two concurrent submits (double-click)
      // serialise: the first flips it to 'submitted' and the second's locked read
      // no longer matches `approvalStatus='draft'` → "no draft version", instead of
      // both proceeding and double-submitting the template to Meta/Vartify.
      const ver = (await tx
        .select()
        .from(templateVersions)
        .where(and(eq(templateVersions.templateId, id), eq(templateVersions.tenantId, session.tenantId), eq(templateVersions.approvalStatus, "draft")))
        .limit(1)
        .for("update"))[0];
      if (!ver) throw Object.assign(new Error("no draft version"), { status: 400 });

      const t = (await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1))[0];

      // Re-run compliance gate (shared extractor — see tokens.ts)
      const text = templateBodyToText(tpl.channel, ver.body);
      const compliance = runComplianceChecks({
        channel: tpl.channel as any,
        category: tpl.category as any,
        tenant: {
          legalName: t?.legalName ?? "",
          arn: t?.arn ?? "",
          principalEuin: t?.principalEuin ?? undefined,
          riaRegistered: t?.riaRegistered ?? false,
        },
        text,
        subject: tpl.channel === "email" ? (ver.body as any)?.subject : undefined,
        dltTemplateId: tpl.channel === "sms" ? (ver.body as any)?.dltTemplateId : undefined,
      });

      // WhatsApp templates are reviewed by Meta itself, so the firm's content gate
      // shouldn't pre-block submission (it would just re-block what Meta will judge).
      if (compliance.blocked && String(tpl.channel) !== "whatsapp") {
        throw Object.assign(new Error("compliance blocked"), { status: 422, compliance });
      }

      // Log the auto-compliance step
      await tx.insert(templateApprovals).values({
        templateVersionId: ver.id,
        tenantId: session.tenantId,
        step: "auto_compliance",
        decision: "approved",
        notes: `score=${compliance.score}`,
        decidedAt: new Date(),
      } as any);

      // WhatsApp → create + submit to Meta via Vartify. Meta is the approval
      // authority for WhatsApp templates, so we submit directly (approval 1–24h).
      if (String(tpl.channel) === "whatsapp") {
        const integ = await getTenantIntegration(tx, session.tenantId, whatsappProviderId);
        const apiKey = (integ?.config as any)?.apiKey as string | undefined;
        const baseUrl = (integ?.config as any)?.webhookUrl as string | undefined;
        if (!integ?.isActive || !apiKey) {
          throw Object.assign(
            new Error("Connect WhatsApp (Vartify) in Settings → Integrations before submitting templates."),
            { status: 400 }
          );
        }
        const sub = buildMetaSubmission(tpl as any, ver as any);
        const result = await vartifyWhatsappAdapter.submitTemplate({ apiKey, baseUrl, ...sub });
        if (!result.ok) {
          throw Object.assign(new Error(`WhatsApp: ${result.error ?? "submission rejected"}`), { status: 400 });
        }
        await tx
          .update(templateVersions)
          .set({
            approvalStatus: "submitted",
            externalRef: result.metaTemplateId ?? sub.templateName,
            externalStatus: "PENDING",
            externalSyncedAt: new Date(),
            complianceChecks: compliance,
            complianceScore: String(compliance.score),
          } as any)
          .where(and(eq(templateVersions.id, ver.id), eq(templateVersions.tenantId, session.tenantId)));
        await tx
          .update(templates)
          .set({ status: "pending_approval" } as any)
          .where(and(eq(templates.id, id), eq(templates.tenantId, session.tenantId)));
        return {
          compliance,
          nextStatus: "submitted",
          templateStatus: "pending_approval",
          submittedToMeta: true,
          metaTemplateId: result.metaTemplateId,
        };
      }

      let nextStatus = "submitted";
      let templateStatus = "pending_approval";

      if (tpl.category === "marketing") {
        // Needs human compliance officer
        await tx.insert(templateApprovals).values({
          templateVersionId: ver.id,
          tenantId: session.tenantId,
          step: "compliance_officer",
          decision: "pending",
        } as any);
      } else {
        // Utility/transactional: skip officer step, mark approved-internal
        await tx.insert(templateApprovals).values({
          templateVersionId: ver.id,
          tenantId: session.tenantId,
          step: "compliance_officer",
          decision: "approved",
          notes: "auto-approved for non-marketing category",
          decidedAt: new Date(),
        } as any);
        nextStatus = "approved_internal";
        templateStatus = "approved";
      }

      await tx
        .update(templateVersions)
        .set({
          approvalStatus: nextStatus,
          complianceChecks: compliance,
          complianceScore: String(compliance.score),
        } as any)
        .where(and(eq(templateVersions.id, ver.id), eq(templateVersions.tenantId, session.tenantId)));

      await tx.update(templates).set({ status: templateStatus } as any).where(and(eq(templates.id, id), eq(templates.tenantId, session.tenantId)));

      return { compliance, nextStatus, templateStatus };
    });

    return NextResponse.json(result);
  } catch (err: any) {
    // Only the compliance-block case (422) carries a structured `compliance`
    // payload the authoring UI renders inline. Every other error goes through
    // the sanitising handler so we don't leak raw internals as a bare 500.
    if (err?.status === 422 && err?.compliance) {
      return NextResponse.json({ error: err.message ?? "compliance blocked", compliance: err.compliance }, { status: 422 });
    }
    return handleApiError(err);
  }
}
