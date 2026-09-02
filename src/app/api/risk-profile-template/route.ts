import { handleApiError } from "@/lib/api/error-handler";
/**
 * Risk-profile template API.
 *
 *   GET  /api/risk-profile-template   — read tenant's active template
 *                                       (or the seed default if not customised)
 *   PUT  /api/risk-profile-template   — publish a new version
 *   POST /api/risk-profile-template/reset — restore the seed default as the
 *                                            active template
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { riskProfileTemplates } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { loadActiveTemplate, RiskTemplateSchema, validateBands } from "@/lib/risk-profile/template";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    const tpl = await withTenant(session.tenantId, async (tx) => loadActiveTemplate(tx, session.tenantId));
    return NextResponse.json({ template: tpl });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await requireSession();
    // Reuse the same capability as other settings edits.
    requireCap(session.roles, "settings.users", session.permissions);

    const parse = RiskTemplateSchema.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const tpl = parse.data;

    // Strict structural validation
    const bandIssues = validateBands(tpl);
    if (bandIssues.length > 0) {
      return NextResponse.json({ error: "Band coverage invalid", issues: bandIssues }, { status: 400 });
    }
    // Unique question keys
    const keys = new Set<string>();
    for (const q of tpl.questions) {
      if (keys.has(q.key)) {
        return NextResponse.json({ error: `Duplicate question key "${q.key}"` }, { status: 400 });
      }
      keys.add(q.key);
    }

    const meta = clientMetaFromHeaders(req.headers);

    const saved = await withTenant(session.tenantId, async (tx) => {
      // Deactivate current version (if any), then insert a new one.
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
          requireEmailOtp: tpl.requireEmailOtp,
          publishedBy: session.userId,
          publishedAt: new Date(),
        })
        .returning();

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "risk_profile_template.publish",
        entityType: "risk_profile_template",
        entityId: inserted.id,
        before: current ?? null,
        after: inserted,
        ...meta,
      });
      return inserted;
    });

    return NextResponse.json({ template: saved }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
