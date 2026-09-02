import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/suitability-matrix/prefill
 *
 * Seeds the 9 suitability-matrix cells from the Network FP "3.2" defaults
 * (src/lib/mf-selection/suitability-defaults.ts).
 *
 * Idempotent + non-destructive by default: only cells that are currently
 * empty (no coarse categories) get filled, so re-running never clobbers
 * IC edits. Pass `{ force: true }` to overwrite every cell with the
 * defaults (e.g. "reset to recommended").
 *
 * Returns { filled, skipped } counts.
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
import { SUITABILITY_DEFAULTS } from "@/lib/mf-selection/suitability-defaults";

export const dynamic = "force-dynamic";

const Body = z.object({ force: z.boolean().optional().default(false) });

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const { force } = Body.parse(await req.json().catch(() => ({})));
    const meta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      const existing = await tx
        .select()
        .from(suitabilityMatrixEntries)
        .where(eq(suitabilityMatrixEntries.tenantId, session.tenantId));

      let filled = 0;
      let skipped = 0;

      for (const def of SUITABILITY_DEFAULTS) {
        const cur = existing.find(
          (e) =>
            e.riskProfile === def.riskProfile &&
            e.timeHorizon === def.timeHorizon
        );
        const cellHasContent =
          cur && (cur.coarseCategories ?? []).length > 0;

        // Non-destructive: skip cells the IC has already filled, unless force.
        if (cellHasContent && !force) {
          skipped++;
          continue;
        }

        if (cur) {
          await tx
            .update(suitabilityMatrixEntries)
            .set({
              coarseCategories: def.coarseCategories,
              allocationHints: def.allocationHints,
              notes: def.notes,
              updatedBy: session.userId,
              updatedAt: new Date(),
            } as any)
            .where(eq(suitabilityMatrixEntries.id, cur.id));
        } else {
          await tx.insert(suitabilityMatrixEntries).values({
            tenantId: session.tenantId,
            riskProfile: def.riskProfile,
            timeHorizon: def.timeHorizon,
            coarseCategories: def.coarseCategories,
            allocationHints: def.allocationHints,
            notes: def.notes,
            updatedBy: session.userId,
          } as any);
        }
        filled++;
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "suitability_matrix.prefill",
        entityType: "suitability_matrix",
        entityId: session.tenantId,
        after: { filled, skipped, force } as any,
        ...meta,
      });

      return { filled, skipped };
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
