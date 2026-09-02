import { handleApiError } from "@/lib/api/error-handler";
/**
 * Onboarding pipelines collection.
 *
 *   GET  /api/onboarding              — list all pipelines for the tenant
 *   POST /api/onboarding              — start a pipeline for an investor
 *
 * Creating a pipeline is idempotent — if one already exists for the investor,
 * we return the existing id rather than fail.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { onboardingPipelines, investors, eventsOutbox } from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  investorId: z.string().uuid(),
  assignedRmId: z.string().uuid().optional(),
  expectedCompletionAt: z.string().optional(), // ISO date
  pendingDocuments: z.array(z.string()).optional(),
  remarks: z.string().optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    const rows = await withTenant(session.tenantId, async (tx) => {
      return tx.execute(sql`
        SELECT op.*, i.name AS investor_name, i.pan AS investor_pan, i.segment_tag,
               u.name AS rm_name
        FROM onboarding_pipelines op
        LEFT JOIN investors i ON i.id = op.investor_id
        LEFT JOIN users u ON u.id = op.assigned_rm_id
        ORDER BY op.created_at DESC
        LIMIT 500
      `);
    });
    return NextResponse.json({ pipelines: rows.rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "onboarding.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const body = parse.data;
    const clientMeta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      // Idempotency — return existing pipeline if any
      const existing = (await tx
        .select()
        .from(onboardingPipelines)
        .where(eq(onboardingPipelines.investorId, body.investorId))
        .limit(1))[0];
      if (existing) {
        return { id: existing.id, currentStage: existing.currentStage, alreadyExisted: true };
      }

      const inv = (await tx.select().from(investors).where(eq(investors.id, body.investorId)).limit(1))[0];
      if (!inv) throw Object.assign(new Error("investor not found"), { status: 404 });

      const id = uuid();
      await tx.insert(onboardingPipelines).values({
        id,
        tenantId: session.tenantId,
        investorId: body.investorId,
        branchId: session.branchId ?? null,
        assignedRmId: body.assignedRmId ?? inv.rmId ?? session.userId,
        currentStage: "first_meeting",
        stages: {},
        pendingDocuments: body.pendingDocuments ?? [],
        expectedCompletionAt: body.expectedCompletionAt ?? null,
        remarks: body.remarks ?? null,
      } as any);

      await tx.insert(eventsOutbox).values({
        tenantId: session.tenantId,
        kind: "onboarding.started",
        entityType: "onboarding_pipeline",
        entityId: id,
        after: { investorId: body.investorId, currentStage: "first_meeting" },
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "onboarding.start",
        entityType: "onboarding_pipeline",
        entityId: id,
        after: { investorId: body.investorId, name: inv.name },
        ...clientMeta,
      });

      return { id, currentStage: "first_meeting", alreadyExisted: false };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
