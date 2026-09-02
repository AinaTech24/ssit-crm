import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/leads/[id]/stage
 * Body: { stage: 'new'|'contacted'|'qualified'|'proposal_sent'|'converted'|'lost'|'cold' }
 *
 * Updates the lead's stage and emits a stage-change event so workflows can react.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { leads, eventsOutbox } from "@/db/schema";
import { loadEditableLead } from "@/lib/leads/access";
import { CANONICAL_LEAD_STAGES, normalizeLeadStage } from "@/lib/leads/normalize";
import { scoreFields } from "@/lib/leads/score";

export const dynamic = "force-dynamic";

const Body = z.object({
  stage: z.string().min(2).max(60),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

    const clientMeta = clientMetaFromHeaders(req.headers);
    const result = await withTenant(session.tenantId, async (tx) => {
      const before = await loadEditableLead(tx, session, id);
      const nextStage = normalizeLeadStage(parse.data.stage);
      if (!CANONICAL_LEAD_STAGES.includes(nextStage)) {
        return null;
      }
      const stageChangedAt = new Date();
      // Re-score on every stage change — the stage is the strongest funnel
      // signal, so the persisted score must move with it.
      const scored = scoreFields(
        { ...(before as any), stage: nextStage, stageChangedAt },
        stageChangedAt.getTime()
      );
      const after = await tx
        .update(leads)
        .set({ stage: nextStage, stageChangedAt, updatedAt: new Date(), ...scored } as any)
        .where(eq(leads.id, id))
        .returning();
      await tx.insert(eventsOutbox).values([
        {
          tenantId: session.tenantId,
          kind: `lead.stage.${nextStage}`,
          entityType: "lead",
          entityId: id,
          before: { stage: before.stage } as any,
          after: { stage: nextStage } as any,
          meta: { userId: session.userId } as any,
        },
        // Also emit the generic record-edit event so record_action "edit" rules
        // (which key on lead.updated) fire on a stage move, not just on /won.
        {
          tenantId: session.tenantId,
          kind: "lead.updated",
          entityType: "lead",
          entityId: id,
          before: before as any,
          after: (after[0] ?? before) as any,
          meta: { userId: session.userId, source: "stage_change" } as any,
        },
      ] as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "lead.stage_change",
        entityType: "lead",
        entityId: id,
        before: { stage: before.stage },
        after: { stage: nextStage },
        ...clientMeta,
      });

      return after[0];
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
