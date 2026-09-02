import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/risk-profile-template/reset — replace the active template with
 * the seed default. Same versioning rules as PUT.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { riskProfileTemplates } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { defaultTemplate } from "@/lib/risk-profile/template";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    const tpl = defaultTemplate();
    const meta = clientMetaFromHeaders(req.headers);

    const saved = await withTenant(session.tenantId, async (tx) => {
      const [current] = await tx
        .select()
        .from(riskProfileTemplates)
        .where(and(eq(riskProfileTemplates.tenantId, session.tenantId), eq(riskProfileTemplates.isActive, true)))
        .orderBy(desc(riskProfileTemplates.versionNumber))
        .limit(1);
      const nextVersion = (current?.versionNumber ?? 0) + 1;
      if (current) {
        await tx
          .update(riskProfileTemplates)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(riskProfileTemplates.id, current.id));
      }
      const [inserted] = await tx
        .insert(riskProfileTemplates)
        .values({
          tenantId: session.tenantId,
          versionNumber: nextVersion,
          isActive: true,
          name: tpl.name,
          description: tpl.description ?? null,
          questions: tpl.questions as any,
          bands: tpl.bands as any,
          reviewIntervalDays: tpl.reviewIntervalDays,
          // Resetting the questionnaire shouldn't silently flip the firm's
          // OTP policy — carry the current setting forward.
          requireEmailOtp: current?.requireEmailOtp ?? true,
          publishedBy: session.userId,
          publishedAt: new Date(),
        })
        .returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "risk_profile_template.reset",
        entityType: "risk_profile_template",
        entityId: inserted.id,
        ...meta,
      });
      return inserted;
    });

    return NextResponse.json({ template: saved });
  } catch (err: any) {
    return handleApiError(err);
  }
}
