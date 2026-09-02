import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single onboarding-pipeline endpoints.
 *
 *   GET    /api/onboarding/[id]   — fetch one pipeline
 *   PATCH  /api/onboarding/[id]   — update assignedRm, expectedCompletion, remarks, on-hold
 *   DELETE /api/onboarding/[id]   — abandon (status='abandoned'). Data preserved.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { onboardingPipelines } from "@/db/schema";

export const dynamic = "force-dynamic";

const Patch = z.object({
  assignedRmId: z.string().uuid().optional(),
  expectedCompletionAt: z.string().optional(),
  pendingDocuments: z.array(z.string()).optional(),
  remarks: z.string().optional(),
  status: z.enum(["in_progress", "on_hold", "abandoned"]).optional(),
  onHoldReason: z.string().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const row = await withTenant(session.tenantId, async (tx) =>
      (await tx.select().from(onboardingPipelines).where(and(eq(onboardingPipelines.id, id), eq(onboardingPipelines.tenantId, session.tenantId))).limit(1))[0] ?? null
    );
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "onboarding.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const clientMeta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      const r = await tx
        .update(onboardingPipelines)
        .set({ ...parse.data, updatedAt: new Date() } as any)
        .where(and(eq(onboardingPipelines.id, id), eq(onboardingPipelines.tenantId, session.tenantId)))
        .returning();
      if (!r[0]) return null;
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "onboarding.update",
        entityType: "onboarding_pipeline",
        entityId: id,
        after: parse.data as any,
        ...clientMeta,
      });
      return r[0];
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "onboarding.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const clientMeta = clientMetaFromHeaders(req.headers);
    await withTenant(session.tenantId, async (tx) => {
      await tx
        .update(onboardingPipelines)
        .set({ status: "abandoned", updatedAt: new Date() } as any)
        .where(and(eq(onboardingPipelines.id, id), eq(onboardingPipelines.tenantId, session.tenantId)));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "onboarding.abandon",
        entityType: "onboarding_pipeline",
        entityId: id,
        ...clientMeta,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
