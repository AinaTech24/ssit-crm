import { handleApiError } from "@/lib/api/error-handler";
/** PATCH /api/leads/[id]/pipeline — move a lead's pipeline / pipeline stage. */
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { assertActiveLicense } from "@/lib/auth/license";
import { loadEditableLead } from "@/lib/leads/access";
import { leads, eventsOutbox } from "@/db/schema";
import { PIPELINE_KEYS, PIPELINES } from "@/lib/pipelines/config";

export const dynamic = "force-dynamic";

const Body = z.object({
  pipeline: z.enum(PIPELINE_KEYS).optional(),
  pipelineStage: z.string().max(40).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const { pipeline, pipelineStage } = parse.data;
    const patch: any = { updatedAt: new Date() };
    if (pipeline !== undefined) patch.pipeline = pipeline;
    if (pipelineStage !== undefined) patch.pipelineStage = pipelineStage;

    const row = await withTenant(session.tenantId, async (tx) => {
      // Capability + ownership + tenant gate (throws 403/404), matching the
      // other /leads/[id]/* mutations (audit: this route was RBAC-ungated).
      const before = await loadEditableLead(tx, session, id);
      // Validate the stage belongs to the target pipeline — the new one if the
      // pipeline is also changing, otherwise the lead's CURRENT pipeline (the
      // old code only validated when both were supplied, letting a bare stage
      // change set a stage from another pipeline).
      if (pipelineStage) {
        const effectivePipeline = (pipeline ?? before.pipeline) as keyof typeof PIPELINES;
        if (!PIPELINES[effectivePipeline]?.stages.some((s) => s.key === pipelineStage)) {
          return { badStage: true as const };
        }
      }
      const [updated] = await tx.update(leads).set(patch).where(and(eq(leads.id, id), eq(leads.tenantId, session.tenantId))).returning();
      if (updated) {
        await tx.insert(eventsOutbox).values({
          tenantId: session.tenantId,
          kind: "lead.updated",
          entityType: "lead",
          entityId: id,
          before: before as any,
          after: updated as any,
          meta: { userId: session.userId, source: "pipeline" } as any,
        } as any);
      }
      return updated;
    }, { userId: session.userId, branchId: session.branchId, roles: session.roles });
    if (row && "badStage" in row) return NextResponse.json({ error: "stage not in pipeline" }, { status: 400 });
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ lead: { id: row.id, pipeline: row.pipeline, pipelineStage: row.pipelineStage } });
  } catch (err: any) { return handleApiError(err); }
}
