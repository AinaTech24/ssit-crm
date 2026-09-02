import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/blueprints
 *
 * List the tenant's 5 workflow blueprints with their ordered stages (for the
 * mobile Blueprint editor). Mirrors the web /dashboard/settings/blueprints page;
 * stage edits go to PUT /api/blueprints/[id]/stages.
 */

import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { blueprintDefinitions, blueprintStages } from "@/db/schema";
import { ensureCatalogSeeded } from "@/lib/blueprints/poly-engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await requireSession();
    const blueprints = await withTenant(
      session.tenantId,
      async (tx) => {
        await ensureCatalogSeeded(tx as any, session.tenantId);
        const defs = await tx
          .select()
          .from(blueprintDefinitions)
          .where(eq(blueprintDefinitions.isActive, true))
          .orderBy(asc(blueprintDefinitions.moduleName));
        const out: any[] = [];
        for (const d of defs) {
          const stages = await tx
            .select({
              id: blueprintStages.id,
              stageKey: blueprintStages.stageKey,
              stageName: blueprintStages.stageName,
              stageOrder: blueprintStages.stageOrder,
              slaDays: blueprintStages.slaDays,
              description: blueprintStages.description,
            })
            .from(blueprintStages)
            .where(eq(blueprintStages.blueprintId, d.id))
            .orderBy(asc(blueprintStages.stageOrder));
          out.push({ id: d.id, moduleName: d.moduleName, blueprintName: (d as any).blueprintName ?? null, stages });
        }
        return out;
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );
    return NextResponse.json({ blueprints });
  } catch (err) {
    return handleApiError(err);
  }
}
