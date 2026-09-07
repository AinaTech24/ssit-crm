import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, desc } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { templates, templateVersions } from "@/db/schema";
import { v4 as uuid } from "uuid";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    // New version = new content. Firm-admin only, same bar as create/edit.
    requireCap(session.roles, "template.create", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const clientMeta = clientMetaFromHeaders(req.headers);
    const result = await withTenant(session.tenantId, async (tx) => {
      // Find the parent template (tenant-scoped)
      const tpl = (await tx.select().from(templates).where(and(eq(templates.id, id), eq(templates.tenantId, session.tenantId))).limit(1))[0];
      if (!tpl) throw Object.assign(new Error("template not found"), { status: 404 });

      // Check if there is already a draft or submitted version
      const existingDraft = (await tx
        .select()
        .from(templateVersions)
        .where(
          and(
            eq(templateVersions.templateId, id),
            eq(templateVersions.tenantId, session.tenantId),
            eq(templateVersions.approvalStatus, "draft")
          )
        )
        .limit(1))[0];
      if (existingDraft) {
        return { ok: true, versionId: existingDraft.id, message: "Draft version already exists" };
      }

      // Find the last version number
      const lastVer = (await tx
        .select()
        .from(templateVersions)
        .where(and(eq(templateVersions.templateId, id), eq(templateVersions.tenantId, session.tenantId)))
        .orderBy(desc(templateVersions.versionNumber))
        .limit(1))[0];
      if (!lastVer) throw Object.assign(new Error("no template versions found"), { status: 400 });

      const newVerId = uuid();
      const newVersionNumber = lastVer.versionNumber + 1;

      // Insert new template version duplicating body and variables
      await tx.insert(templateVersions).values({
        id: newVerId,
        templateId: id,
        tenantId: session.tenantId,
        versionNumber: newVersionNumber,
        body: lastVer.body,
        variables: lastVer.variables,
        approvalStatus: "draft",
        complianceChecks: null,
        complianceScore: null,
        autoComplianceBlocked: false,
        createdByUserId: session.userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      // Update template to point to new draft version and set status to draft
      await tx
        .update(templates)
        .set({
          currentVersionId: newVerId,
          status: "draft",
          updatedAt: new Date(),
        } as any)
        .where(and(eq(templates.id, id), eq(templates.tenantId, session.tenantId)));

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "template.version_create",
        entityType: "template",
        entityId: id,
        after: { versionId: newVerId, versionNumber: newVersionNumber },
        ...clientMeta,
      });

      return { ok: true, versionId: newVerId, versionNumber: newVersionNumber };
    });

    return NextResponse.json(result);
  } catch (err: any) {
    // Two concurrent "new version" requests both compute last+1 → unique
    // violation on (template_id, version_number). Surface a friendly 409.
    if (err?.code === "23505" || /tpl_versions_unique/.test(String(err?.message ?? ""))) {
      return NextResponse.json(
        { error: "Another draft version was just created — refresh and try again." },
        { status: 409 }
      );
    }
    return handleApiError(err);
  }
}
