import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { templates, templateApprovals, templateVersions } from "@/db/schema";
import { z } from "zod";

export const dynamic = "force-dynamic";

const RejectBody = z.object({
  reason: z.string().min(1, "Reason is required"),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "template.approve", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const bodyParse = RejectBody.safeParse(await req.json().catch(() => ({})));
    if (!bodyParse.success) {
      return NextResponse.json({ error: bodyParse.error.errors[0]?.message ?? "invalid body" }, { status: 400 });
    }
    const { reason } = bodyParse.data;

    const clientMeta = clientMetaFromHeaders(req.headers);
    const result = await withTenant(session.tenantId, async (tx) => {
      const ver = (await tx
        .select()
        .from(templateVersions)
        .where(and(eq(templateVersions.templateId, id), eq(templateVersions.tenantId, session.tenantId), eq(templateVersions.approvalStatus, "submitted")))
        .limit(1))[0];
      if (!ver) throw Object.assign(new Error("no submitted version"), { status: 400 });

      // Update the compliance officer step in templateApprovals
      await tx
        .update(templateApprovals)
        .set({
          decision: "rejected",
          notes: reason,
          decidedAt: new Date(),
          decidedByUserId: session.userId,
        } as any)
        .where(
          and(
            eq(templateApprovals.templateVersionId, ver.id),
            eq(templateApprovals.tenantId, session.tenantId),
            eq(templateApprovals.step, "compliance_officer")
          )
        );

      // Update the version approval status and reason
      await tx
        .update(templateVersions)
        .set({
          approvalStatus: "rejected",
          rejectionReason: reason,
          updatedAt: new Date(),
        } as any)
        .where(and(eq(templateVersions.id, ver.id), eq(templateVersions.tenantId, session.tenantId)));

      // Update parent template status
      const tpl = (await tx.update(templates).set({ status: "rejected", updatedAt: new Date() } as any).where(and(eq(templates.id, id), eq(templates.tenantId, session.tenantId))).returning())[0];

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "template.reject",
        entityType: "template",
        entityId: id,
        after: { versionId: ver.id, channel: tpl?.channel, reason },
        ...clientMeta,
      });

      return { ok: true, versionId: ver.id };
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
