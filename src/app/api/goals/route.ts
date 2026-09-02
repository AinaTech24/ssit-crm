import { handleApiError } from "@/lib/api/error-handler";
/**
 * Goals collection.
 *
 *   GET  /api/goals                 — list with joined investor + computed status
 *   POST /api/goals                 — create new goal, auto-computes SIP requirements
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, or, asc, desc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny, can } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { goals, investors } from "@/db/schema";
import { computeGoal, monthsBetween } from "@/lib/goal-planning/calc";
import { expectedProgressPct } from "@/lib/goal-planning/recompute";
import { effectiveGlideReturn } from "@/lib/goal-planning/glide-path";

export const dynamic = "force-dynamic";

const Body = z.object({
  investorId: z.string().uuid(),
  name: z.string().min(2).max(120),
  category: z.enum([
    "retirement", "child_education", "child_marriage", "house", "car",
    "vacation", "emergency_fund", "wealth_creation", "other",
    "education", "vehicle", "emergency", "wedding", "wealth", // legacy aliases
  ]),
  targetAmount: z.number().positive(),
  targetDate: z.string(), // ISO date
  targetMode: z.enum(["today", "future"]).default("future"),
  presentTargetAmount: z.number().positive().optional(),
  inflationPct: z.number().min(0).max(20).default(6),
  stepUpPct: z.number().min(0).max(30).default(0),
  currentValue: z.number().nonnegative().default(0),
  existingMonthlySip: z.number().nonnegative().default(0),
  expectedReturnPct: z.number().min(1).max(30).default(12),
  glidePath: z.enum(["none", "conservative", "moderate", "aggressive"]).default("none"),
  remarks: z.string().optional(),
  nextReviewAt: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    // Goals expose client financial planning (targets, required SIP, client
    // name). Require an investor-view capability and scope non-managers to
    // their own clients' goals.
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    const canViewAll = can(session.roles, "investor.view.all", session.permissions);

    const url = req.nextUrl;
    const q = (url.searchParams.get("q") ?? "").trim();
    const statusFilter = (url.searchParams.get("status") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const sortKey = url.searchParams.get("sort") ?? "target_date_asc";
    const orderBy =
      sortKey === "target_date_desc" ? desc(goals.targetDate)
      : sortKey === "target_amount_desc" ? desc(goals.targetAmount)
      : sortKey === "target_amount_asc" ? asc(goals.targetAmount)
      : asc(goals.targetDate);

    const data = await withTenant(
      session.tenantId,
      async (tx) => {
        const conds: any[] = [isNull(investors.deletedAt)];
        if (!canViewAll) conds.push(eq(investors.rmId, session.userId));
        if (q) conds.push(or(ilike(goals.name, `%${q}%`), ilike(investors.name, `%${q}%`)));
        if (statusFilter.length) conds.push(inArray(goals.status, statusFilter as any));

        const rows = await tx
          .select({ goal: goals, investorName: investors.name, investorAvatarUrl: investors.avatarUrl })
          .from(goals)
          .leftJoin(investors, eq(investors.id, goals.investorId))
          .where(and(...conds))
          .orderBy(orderBy)
          .limit(500);

        // KPI ribbon — over the full scope (not the filtered/searched slice),
        // mirroring the web goals page.
        const scope = canViewAll
          ? sql`(g.investor_id IS NULL OR g.investor_id IN (SELECT id FROM investors WHERE deleted_at IS NULL))`
          : sql`g.investor_id IN (SELECT id FROM investors WHERE rm_id = ${session.userId}::uuid AND deleted_at IS NULL)`;
        const statsRes = await tx.execute(sql`
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'on_track')::int AS on_track,
            COUNT(*) FILTER (WHERE status = 'behind_track')::int AS behind,
            COUNT(*) FILTER (WHERE status = 'achieved')::int AS achieved,
            COUNT(*) FILTER (WHERE status = 'not_started')::int AS not_started,
            COUNT(*) FILTER (WHERE next_review_at IS NOT NULL AND next_review_at < now() AND status NOT IN ('achieved','abandoned'))::int AS reviews_overdue
          FROM goals g WHERE ${scope}
        `);

        return {
          goals: rows.map((r) => ({ ...r.goal, investorName: r.investorName, investorAvatarUrl: r.investorAvatarUrl })),
          stats: (statsRes.rows[0] ?? {}) as any,
        };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    return NextResponse.json({ goals: data.goals, stats: data.stats });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "goal.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const body = parse.data;
    const clientMeta = clientMetaFromHeaders(req.headers);

    const id = uuid();
    const now = new Date();
    const target = new Date(body.targetDate);
    const monthsLeft = monthsBetween(now, target);
    // Apply the glide path: the effective return tapers as the target nears.
    const effReturn = effectiveGlideReturn(body.expectedReturnPct, monthsLeft / 12, body.glidePath);
    const calc = computeGoal({
      presentTarget: body.targetMode === "today" ? body.presentTargetAmount : undefined,
      futureTarget: body.targetMode === "future" ? body.targetAmount : undefined,
      currentValue: body.currentValue,
      existingMonthlySip: body.existingMonthlySip,
      monthsLeft,
      expectedReturnPct: effReturn,
      inflationPct: body.inflationPct,
      stepUpPct: body.stepUpPct,
    });

    await withTenant(session.tenantId, async (tx) => {
      const inv = (await tx.select().from(investors).where(eq(investors.id, body.investorId)).limit(1))[0];
      if (!inv) throw Object.assign(new Error("investor not found"), { status: 404 });

      await tx.insert(goals).values({
        id,
        tenantId: session.tenantId,
        investorId: body.investorId,
        name: body.name,
        category: body.category as any,
        targetAmount: Math.round(calc.futureTarget).toString(),
        targetMode: body.targetMode,
        presentTargetAmount: body.presentTargetAmount?.toString() ?? null,
        inflationPct: body.inflationPct.toString(),
        stepUpPct: body.stepUpPct.toString(),
        targetDate: body.targetDate.slice(0, 10),
        startedOn: now.toISOString().slice(0, 10),
        monthlyContribution: body.existingMonthlySip.toString(),
        expectedReturn: body.expectedReturnPct.toString(),
        currentValue: body.currentValue.toString(),
        glidePath: body.glidePath,
        progressPct: (calc.futureTarget > 0
          ? Math.min(100, (body.currentValue / calc.futureTarget) * 100)
          : 0
        ).toFixed(2),
        expectedProgressPct: expectedProgressPct(now, now, body.targetDate.slice(0, 10), now).toFixed(2),
        requiredMonthlySip: calc.requiredMonthlySipTotal.toFixed(2),
        existingMonthlySip: body.existingMonthlySip.toString(),
        gapAmount: calc.gapAmount.toFixed(2),
        status: calc.status as any,
        nextReviewAt: body.nextReviewAt ? new Date(body.nextReviewAt) : null,
        remarks: body.remarks ?? null,
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "goal.create",
        entityType: "goal",
        entityId: id,
        after: {
          name: body.name,
          category: body.category,
          targetAmount: Math.round(calc.futureTarget),
          status: calc.status,
        } as any,
        ...clientMeta,
      });
    });

    return NextResponse.json(
      {
        id,
        status: calc.status,
        requiredMonthlySipTotal: calc.requiredMonthlySipTotal,
        additionalMonthlySipNeeded: calc.additionalMonthlySipNeeded,
        gapAmount: calc.gapAmount,
        projectedTotalFV: calc.projectedTotalFV,
      },
      { status: 201 }
    );
  } catch (err: any) {
    return handleApiError(err);
  }
}
