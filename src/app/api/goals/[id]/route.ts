import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single goal endpoints.
 *
 *   GET    /api/goals/[id]   — fetch one goal
 *   PATCH  /api/goals/[id]   — partial update; recompute SIP fields if relevant inputs change
 *   DELETE /api/goals/[id]   — soft archive (status='abandoned')
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { goals } from "@/db/schema";
import { computeGoal, monthsBetween } from "@/lib/goal-planning/calc";
import { expectedProgressPct } from "@/lib/goal-planning/recompute";
import { effectiveGlideReturn } from "@/lib/goal-planning/glide-path";

export const dynamic = "force-dynamic";

const Patch = z.object({
  name: z.string().min(2).max(120).optional(),
  category: z.string().optional(),
  targetAmount: z.number().positive().optional(),
  targetDate: z.string().optional(),
  targetMode: z.enum(["today", "future"]).optional(),
  presentTargetAmount: z.number().positive().optional(),
  inflationPct: z.number().min(0).max(20).optional(),
  stepUpPct: z.number().min(0).max(30).optional(),
  currentValue: z.number().nonnegative().optional(),
  existingMonthlySip: z.number().nonnegative().optional(),
  expectedReturnPct: z.number().min(1).max(30).optional(),
  glidePath: z.enum(["none", "conservative", "moderate", "aggressive"]).optional(),
  status: z.enum([
    "not_started", "on_track", "behind_track", "achieved",
    "active", "on_hold", "abandoned",
  ]).optional(),
  remarks: z.string().optional(),
  /** Linker — investor folio + SIP ids */
  linkedFolios: z.array(z.string().uuid()).optional(),
  linkedSips: z.array(z.string().uuid()).optional(),
  /** Per-folio allocation (0..100). Folios in linkedFolios without an
   *  entry here are treated as 100%. */
  folioAllocations: z
    .array(
      z.object({
        folioId: z.string().uuid(),
        allocationPct: z.number().min(0).max(100),
      })
    )
    .optional(),
  sipAllocations: z
    .array(
      z.object({
        sipId: z.string().uuid(),
        allocationPct: z.number().min(0).max(100),
      })
    )
    .optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    const row = await withTenant(session.tenantId, async (tx) =>
      (await tx.select().from(goals).where(and(eq(goals.id, id), eq(goals.tenantId, session.tenantId))).limit(1))[0] ?? null
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
    requireCap(session.roles, "goal.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const clientMeta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(goals).where(and(eq(goals.id, id), eq(goals.tenantId, session.tenantId))).limit(1))[0];
      if (!before) return null;

      const patch: any = { ...parse.data, updatedAt: new Date() };

      // Recompute derived fields if any calc input changed
      const inputsChanged =
        parse.data.targetAmount !== undefined ||
        parse.data.presentTargetAmount !== undefined ||
        parse.data.targetMode !== undefined ||
        parse.data.inflationPct !== undefined ||
        parse.data.stepUpPct !== undefined ||
        parse.data.targetDate !== undefined ||
        parse.data.currentValue !== undefined ||
        parse.data.existingMonthlySip !== undefined ||
        parse.data.expectedReturnPct !== undefined ||
        parse.data.glidePath !== undefined;

      if (inputsChanged) {
        const targetMode = parse.data.targetMode ?? before.targetMode ?? "future";
        const inflationPct = parse.data.inflationPct ?? (before.inflationPct ? Number(before.inflationPct) : 6);
        const stepUpPct = parse.data.stepUpPct ?? (before.stepUpPct ? Number(before.stepUpPct) : 0);
        const expectedReturnPct = parse.data.expectedReturnPct ?? Number(before.expectedReturn ?? 12);
        const currentValue = parse.data.currentValue ?? Number(before.currentValue ?? 0);
        const existingSip = parse.data.existingMonthlySip ?? Number(before.existingMonthlySip ?? 0);
        const targetDate = new Date(parse.data.targetDate ?? before.targetDate);
        const monthsLeft = monthsBetween(new Date(), targetDate);

        let presentTarget: number | undefined;
        let futureTarget: number | undefined;

        if (targetMode === "today") {
          presentTarget = parse.data.presentTargetAmount ?? (before.presentTargetAmount ? Number(before.presentTargetAmount) : undefined);
          if (presentTarget === undefined) {
            const fT = parse.data.targetAmount ?? Number(before.targetAmount);
            presentTarget = fT / Math.pow(1 + inflationPct / 100, monthsLeft / 12);
          }
        } else {
          futureTarget = parse.data.targetAmount ?? Number(before.targetAmount);
        }

        const glidePath = parse.data.glidePath ?? (before as any).glidePath ?? "none";
        const effReturn = effectiveGlideReturn(expectedReturnPct, monthsLeft / 12, glidePath);
        const calc = computeGoal({
          presentTarget,
          futureTarget,
          currentValue,
          existingMonthlySip: existingSip,
          monthsLeft,
          expectedReturnPct: effReturn,
          inflationPct,
          stepUpPct,
        });

        patch.targetAmount = Math.round(calc.futureTarget).toString();
        patch.presentTargetAmount = targetMode === "today" && presentTarget !== undefined ? presentTarget.toString() : null;
        patch.targetMode = targetMode;
        patch.inflationPct = inflationPct.toString();
        patch.stepUpPct = stepUpPct.toString();

        patch.requiredMonthlySip = calc.requiredMonthlySipTotal.toFixed(2);
        patch.existingMonthlySip = existingSip.toString();
        patch.gapAmount = calc.gapAmount.toFixed(2);
        patch.progressPct = (calc.futureTarget > 0 ? Math.min(100, (currentValue / calc.futureTarget) * 100) : 0).toFixed(2);
        patch.expectedProgressPct = expectedProgressPct(
          before.startedOn,
          before.createdAt,
          (parse.data.targetDate ?? before.targetDate) as any,
          new Date()
        ).toFixed(2);
        if (!parse.data.status) patch.status = calc.status;
      }

      // Map expectedReturnPct to expectedReturn DB column, and delete expectedReturnPct
      if (patch.expectedReturnPct !== undefined) {
        patch.expectedReturn = patch.expectedReturnPct.toString();
        delete patch.expectedReturnPct;
      }

      // Map existingMonthlySip to monthlyContribution DB column
      if (patch.existingMonthlySip !== undefined) {
        patch.monthlyContribution = patch.existingMonthlySip;
      }

      await tx.update(goals).set(patch).where(and(eq(goals.id, id), eq(goals.tenantId, session.tenantId)));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "goal.update",
        entityType: "goal",
        entityId: id,
        after: parse.data as any,
        ...clientMeta,
      });
      return { ok: true };
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
    requireCap(session.roles, "goal.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const clientMeta = clientMetaFromHeaders(req.headers);
    await withTenant(session.tenantId, async (tx) => {
      await tx.update(goals).set({ status: "abandoned", updatedAt: new Date() } as any).where(and(eq(goals.id, id), eq(goals.tenantId, session.tenantId)));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "goal.archive",
        entityType: "goal",
        entityId: id,
        ...clientMeta,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
