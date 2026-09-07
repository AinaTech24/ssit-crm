import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single template endpoints.
 *
 *   GET    /api/templates/[id]   — fetch one template
 *   PATCH  /api/templates/[id]   — update name/category/status / body / variables (draft only)
 *   DELETE /api/templates/[id]   — archive (status='archived')
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { templates, templateVersions, tenants } from "@/db/schema";
import { runComplianceChecks } from "@/lib/comms/compliance";
import { templateBodyToText } from "@/lib/comms/tokens";

export const dynamic = "force-dynamic";

const VariableDecl = z.object({
  key: z.string(),
  type: z.enum(["string", "number", "currency", "date", "boolean", "url"]),
  source: z.string().optional(),
  required: z.boolean().optional(),
  fallback: z.any().optional(),
  format: z.string().optional(),
});

const Patch = z.object({
  name: z.string().min(2).max(200).optional(),
  description: z.string().optional(),
  category: z.enum(["transactional", "utility", "marketing", "authentication"]).optional(),
  // SECURITY: `approved` / `pending_approval` are DELIBERATELY excluded. A
  // template only becomes sendable through submit → compliance-officer approve
  // (or the Vartify/Meta sync). Allowing them here let a `template.edit` holder
  // (marketing) self-approve and bypass the entire compliance moat. PATCH may
  // only park a template back to draft, archive it, or pause it.
  status: z.enum(["draft", "archived", "paused"]).optional(),
  body: z.any().optional(),
  variables: z.array(VariableDecl).optional(),
  attachments: z.array(z.object({ name: z.string().max(200), url: z.string().max(2000) })).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    // Firm message content — readable by template managers, comms senders, and
    // workflow builders (who pick templates), not every authenticated user.
    requireAny(session.roles, ["template.view", "template.edit", "communication.send", "workflow.edit"], session.permissions);
    const row = await withTenant(session.tenantId, async (tx) =>
      (await tx.select().from(templates).where(and(eq(templates.id, id), eq(templates.tenantId, session.tenantId))).limit(1))[0] ?? null
    );
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    // Authoring a template is firm-admin only (template.create). NOT
    // template.edit — marketing holds that for the content library, designer
    // test sends and the WhatsApp sync, none of which change what the firm is
    // allowed to say to investors.
    requireCap(session.roles, "template.create", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const { name, description, category, status, body, variables, attachments } = parse.data;
    
    const clientMeta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      // Get parent template (tenant-scoped — defense-in-depth alongside RLS).
      const tpl = (await tx.select().from(templates).where(and(eq(templates.id, id), eq(templates.tenantId, session.tenantId))).limit(1))[0];
      if (!tpl) return null;

      // Get current version
      const ver = tpl.currentVersionId
        ? (await tx.select().from(templateVersions).where(and(eq(templateVersions.id, tpl.currentVersionId), eq(templateVersions.tenantId, session.tenantId))).limit(1))[0]
        : null;

      // If updating body/variables, check if version is draft
      if ((body !== undefined || variables !== undefined) && ver && ver.approvalStatus !== "draft") {
        throw Object.assign(new Error("cannot edit content of a non-draft version. create a new version first."), { status: 400 });
      }

      // Category drives the compliance ruleset + the marketing approval path, so
      // it can only change while the template is in draft. Otherwise an approved
      // transactional template could be flipped to marketing (which needs a
      // compliance officer) while staying sendable — a moat bypass.
      if (category !== undefined && category !== tpl.category && tpl.status !== "draft") {
        throw Object.assign(
          new Error("category can only be changed on a draft template — create a new version, then change it."),
          { status: 400 }
        );
      }

      // Prepare updates
      const templateUpdates: any = {};
      if (name !== undefined) templateUpdates.name = name;
      if (description !== undefined) templateUpdates.description = description;
      if (category !== undefined) templateUpdates.category = category;
      if (status !== undefined) templateUpdates.status = status;
      templateUpdates.updatedAt = new Date();

      // Update parent template
      const r = await tx.update(templates).set(templateUpdates).where(and(eq(templates.id, id), eq(templates.tenantId, session.tenantId))).returning();

      // Update template version body/variables if draft and requested
      if (ver && (body !== undefined || variables !== undefined || category !== undefined || attachments !== undefined)) {
        const t = (await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1))[0];
        
        const finalBody = body !== undefined ? body : ver.body;
        const finalVariables = variables !== undefined ? variables : ver.variables;
        const finalCategory = category !== undefined ? category : tpl.category;

        const text = templateBodyToText(tpl.channel, finalBody);
        const subject = tpl.channel === "email" ? finalBody?.subject : undefined;
        const dltTemplateId = tpl.channel === "sms" ? finalBody?.dltTemplateId : undefined;

        const compliance = runComplianceChecks({
          channel: tpl.channel as any,
          category: finalCategory as any,
          tenant: {
            legalName: t?.legalName ?? "",
            arn: t?.arn ?? "",
            principalEuin: t?.principalEuin ?? undefined,
            riaRegistered: t?.riaRegistered ?? false,
          },
          text,
          subject,
          dltTemplateId,
        });

        await tx
          .update(templateVersions)
          .set({
            body: finalBody,
            variables: finalVariables,
            ...(attachments !== undefined ? { attachments } : {}),
            complianceChecks: compliance,
            complianceScore: String(compliance.score),
            autoComplianceBlocked: compliance.blocked,
            updatedAt: new Date(),
          } as any)
          .where(and(eq(templateVersions.id, ver.id), eq(templateVersions.tenantId, session.tenantId)));
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "template.update",
        entityType: "template",
        entityId: id,
        after: parse.data as any,
        ...clientMeta,
      });
      return r[0];
    });

    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    // Authoring a template is firm-admin only (template.create). NOT
    // template.edit — marketing holds that for the content library, designer
    // test sends and the WhatsApp sync, none of which change what the firm is
    // allowed to say to investors.
    requireCap(session.roles, "template.create", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const clientMeta = clientMetaFromHeaders(req.headers);
    await withTenant(session.tenantId, async (tx) => {
      await tx
        .update(templates)
        .set({ status: "archived", updatedAt: new Date() } as any)
        .where(and(eq(templates.id, id), eq(templates.tenantId, session.tenantId)));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "template.archive",
        entityType: "template",
        entityId: id,
        ...clientMeta,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
