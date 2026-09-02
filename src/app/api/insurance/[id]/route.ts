import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single-insurance-policy endpoints.
 *   GET    /api/insurance/[id]
 *   PATCH  /api/insurance/[id]
 *   DELETE /api/insurance/[id]    (soft = status='cancelled')
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import {
  insurancePolicies,
  investors,
  POLICY_STATUSES,
  POLICY_TYPES,
  PREMIUM_FREQUENCIES,
} from "@/db/schema";

export const dynamic = "force-dynamic";

const Patch = z
  .object({
    policyNumber: z.string().max(60).optional(),
    insurer: z.string().min(1).max(120).optional(),
    planName: z.string().min(1).max(200).optional(),
    policyType: z.enum(POLICY_TYPES).optional(),
    livesCovered: z.number().int().min(1).max(20).optional(),
    sumAssured: z.number().min(0).optional(),
    annualPremium: z.number().min(0).optional(),
    premiumFrequency: z.enum(PREMIUM_FREQUENCIES).optional(),
    premiumPayingTermYears: z.number().int().min(0).max(99).optional(),
    policyTermYears: z.number().int().min(0).max(99).optional(),
    policyStartDate: z.string().optional(),
    riskCoverStartDate: z.string().optional(),
    maturityDate: z.string().optional(),
    lastPremiumDate: z.string().optional(),
    nextPremiumDueDate: z.string().optional(),
    gracePeriodDays: z.number().int().min(0).max(180).optional(),
    nomineeName: z.string().max(120).optional(),
    nomineeRelation: z.string().max(40).optional(),
    nomineeDob: z.string().optional(),
    nomineeShare: z.number().int().min(0).max(100).optional(),
    riders: z.array(z.any()).optional(),
    documents: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
    details: z.record(z.any()).optional(),
    remarks: z.string().max(1000).optional(),
    lapseReason: z.string().max(300).optional(),
    surrenderValue: z.number().min(0).optional(),
    commissionPaisa: z.number().min(0).optional(),
    status: z.enum(POLICY_STATUSES).optional(),
  })
  .strict();

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "insurance.view", session.permissions);
    const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "compliance.view", session.permissions);
    const row = await withTenant(session.tenantId, async (tx) => {
      const p = (
        await tx.select().from(insurancePolicies).where(and(eq(insurancePolicies.id, id), eq(insurancePolicies.tenantId, session.tenantId))).limit(1)
      )[0];
      if (!p) return null;

      const inv = (
        await tx
          .select({ name: investors.name, rmId: investors.rmId })
          .from(investors)
          .where(eq(investors.id, p.investorId))
          .limit(1)
      )[0];

      // Non-managers only see policies for their clients OR that they sold.
      if (!seesAll && p.soldByUserId !== session.userId && inv?.rmId !== session.userId) return null;

      return {
        ...p,
        investorName: inv?.name ?? null,
      };
    });
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
    requireCap(session.roles, "insurance.write", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }
    const clientMeta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (
        await tx.select().from(insurancePolicies).where(and(eq(insurancePolicies.id, id), eq(insurancePolicies.tenantId, session.tenantId))).limit(1)
      )[0];
      if (!before) return null;

      const patch: any = { ...parse.data, updatedAt: new Date() };
      // Coerce numerics → strings for numeric() columns
      for (const k of [
        "sumAssured",
        "annualPremium",
        "surrenderValue",
        "commissionPaisa",
      ] as const) {
        if (patch[k] != null) patch[k] = String(patch[k]);
      }

      const r = await tx
        .update(insurancePolicies)
        .set(patch)
        .where(and(eq(insurancePolicies.id, id), eq(insurancePolicies.tenantId, session.tenantId)))
        .returning();

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "insurance.update",
        entityType: "insurance_policy",
        entityId: id,
        before: { status: before.status, planName: before.planName } as any,
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
    requireCap(session.roles, "insurance.write", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const clientMeta = clientMetaFromHeaders(req.headers);
    await withTenant(session.tenantId, async (tx) => {
      const before = (
        await tx.select().from(insurancePolicies).where(and(eq(insurancePolicies.id, id), eq(insurancePolicies.tenantId, session.tenantId))).limit(1)
      )[0];
      if (!before) return;
      await tx
        .update(insurancePolicies)
        .set({
          status: "cancelled",
          updatedAt: new Date(),
        } as any)
        .where(and(eq(insurancePolicies.id, id), eq(insurancePolicies.tenantId, session.tenantId)));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "insurance.delete",
        entityType: "insurance_policy",
        entityId: id,
        before: { planName: before.planName, status: before.status },
        ...clientMeta,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
