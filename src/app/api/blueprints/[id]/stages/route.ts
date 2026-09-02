import { handleApiError } from "@/lib/api/error-handler";
/**
 * PUT /api/blueprints/[id]/stages — bulk-update stages of a blueprint.
 *
 * Body: { stages: Array<{ id, stageName, description, ownerRole, slaDays, requiredFields, allowedActions, automationsOnEnter }> }
 *
 * Only fields the editor exposes get updated. Stage keys + order stay fixed
 * for now (Phase-2 will add add/remove/reorder).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { blueprintStages } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { invalidateBlueprintCache } from "@/lib/blueprints/engine";

export const dynamic = "force-dynamic";

const StagePatch = z.object({
  id: z.string().uuid(),
  stageName: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  ownerRole: z.string().max(40).nullable().optional(),
  slaDays: z.number().int().min(0).max(365).nullable().optional(),
  requiredFields: z.array(z.string()).max(20).default([]),
  allowedActions: z.array(z.string()).max(20).default([]),
  automationsOnEnter: z.array(z.string()).max(10).default([]),
});

const Body = z.object({ stages: z.array(StagePatch).min(1) });

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    const { id } = await params;
    const meta = clientMetaFromHeaders(req.headers);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }

    await withTenant(session.tenantId, async (tx) => {
      for (const s of parsed.data.stages) {
        await tx
          .update(blueprintStages)
          .set({
            stageName: s.stageName,
            description: s.description ?? null,
            ownerRole: s.ownerRole ?? null,
            slaDays: s.slaDays ?? null,
            requiredFields: s.requiredFields as any,
            allowedActions: s.allowedActions as any,
            automationsOnEnter: s.automationsOnEnter as any,
            updatedAt: new Date(),
          })
          .where(eq(blueprintStages.id, s.id));
      }
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "blueprint.stages.update",
        entityType: "blueprint",
        entityId: id,
        after: { stageCount: parsed.data.stages.length },
        ...meta,
      });
    });
    invalidateBlueprintCache(session.tenantId);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
