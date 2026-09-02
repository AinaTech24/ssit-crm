import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/templates/[id]/approve  — compliance officer approves a marketing template
 * POST /api/templates/[id]/reject   — compliance officer rejects (body: { reason })
 *
 * Once internal approval is done, WA templates wait for Meta approval (synced
 * by the vartify-template-sync worker). Email/SMS go directly to approved.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { templates, templateApprovals, templateVersions } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "template.approve", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const clientMeta = clientMetaFromHeaders(req.headers);
    const result = await withTenant(session.tenantId, async (tx) => {
      const ver = (await tx
        .select()
        .from(templateVersions)
        .where(and(eq(templateVersions.templateId, id), eq(templateVersions.tenantId, session.tenantId), eq(templateVersions.approvalStatus, "submitted")))
        .limit(1))[0];
      if (!ver) throw Object.assign(new Error("no submitted version"), { status: 400 });

      // Maker-checker (segregation of duties): the author of a version may not
      // approve it. Owners are exempt (a solo MFD is both maker and checker).
      if (ver.createdByUserId && ver.createdByUserId === session.userId && !(session.roles ?? []).includes("owner")) {
        throw Object.assign(new Error("you authored this template — a different approver must sign off"), { status: 403 });
      }

      await tx
        .update(templateApprovals)
        .set({ decision: "approved", decidedAt: new Date(), decidedByUserId: session.userId } as any)
        .where(
          and(
            eq(templateApprovals.templateVersionId, ver.id),
            eq(templateApprovals.tenantId, session.tenantId),
            eq(templateApprovals.step, "compliance_officer")
          )
        );

      await tx
        .update(templateVersions)
        .set({
          approvalStatus: "approved_internal",
          approvedByUserId: session.userId,
          approvedAt: new Date(),
        } as any)
        .where(and(eq(templateVersions.id, ver.id), eq(templateVersions.tenantId, session.tenantId)));

      const tpl = (await tx.select().from(templates).where(and(eq(templates.id, id), eq(templates.tenantId, session.tenantId))).limit(1))[0];
      // WA templates still need Meta approval — keep template.status = pending_approval
      // until the sync worker flips to APPROVED on the external side.
      if (tpl?.channel !== "whatsapp") {
        await tx.update(templates).set({ status: "approved" } as any).where(and(eq(templates.id, id), eq(templates.tenantId, session.tenantId)));
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "template.approve",
        entityType: "template",
        entityId: id,
        after: { versionId: ver.id, channel: tpl?.channel },
        ...clientMeta,
      });

      return { ok: true, versionId: ver.id };
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
