import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/suitability-matrix   — return all 9 cells (or fewer if IC
 *                                  hasn't filled some yet)
 * PUT /api/suitability-matrix   — upsert one cell. Idempotent: a second
 *                                  PUT with the same (risk, horizon)
 *                                  updates the existing row.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { suitabilityMatrixEntries } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const COARSE = [
  "equity",
  "hybrid",
  "debt",
  "liquid",
  "commodity",
  "international",
  "other",
] as const;

const PutBody = z.object({
  riskProfile: z.enum(["low", "moderate", "high"]),
  timeHorizon: z.enum(["short", "medium", "long"]),
  coarseCategories: z.array(z.enum(COARSE)).max(7).default([]),
  allocationHints: z.record(z.number().min(0).max(100)).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const rows = await withTenant(session.tenantId, async (tx) => {
      return tx
        .select()
        .from(suitabilityMatrixEntries)
        .where(eq(suitabilityMatrixEntries.tenantId, session.tenantId));
    });
    return NextResponse.json({ entries: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = PutBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }
    const meta = clientMetaFromHeaders(req.headers);
    const d = parse.data;

    const row = await withTenant(session.tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(suitabilityMatrixEntries)
        .where(
          and(
            eq(suitabilityMatrixEntries.tenantId, session.tenantId),
            eq(suitabilityMatrixEntries.riskProfile, d.riskProfile),
            eq(suitabilityMatrixEntries.timeHorizon, d.timeHorizon)
          )
        )
        .limit(1);

      if (existing) {
        const [next] = await tx
          .update(suitabilityMatrixEntries)
          .set({
            coarseCategories: d.coarseCategories,
            allocationHints: d.allocationHints ?? null,
            notes: d.notes ?? null,
            updatedBy: session.userId,
            updatedAt: new Date(),
          } as any)
          .where(eq(suitabilityMatrixEntries.id, existing.id))
          .returning();
        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "suitability_matrix.update",
          entityType: "suitability_matrix",
          entityId: existing.id,
          before: existing,
          after: next,
          ...meta,
        });
        return next;
      }

      const [created] = await tx
        .insert(suitabilityMatrixEntries)
        .values({
          tenantId: session.tenantId,
          riskProfile: d.riskProfile,
          timeHorizon: d.timeHorizon,
          coarseCategories: d.coarseCategories,
          allocationHints: d.allocationHints ?? null,
          notes: d.notes ?? null,
          updatedBy: session.userId,
        } as any)
        .returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "suitability_matrix.create",
        entityType: "suitability_matrix",
        entityId: created.id,
        before: null,
        after: created,
        ...meta,
      });
      return created;
    });
    return NextResponse.json({ entry: row });
  } catch (err: any) {
    return handleApiError(err);
  }
}
