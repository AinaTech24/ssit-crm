import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { financialPlans, investors, leads } from "@/db/schema";
import { handleApiError } from "@/lib/api/error-handler";
import { recomputePlanGoals, numOrNull } from "@/lib/financial-plans/compute";

// Zod schemas for sub-items
const ChildDetailSchema = z.object({
  name: z.string().max(100),
  age: z.number().int().min(0).max(120),
});

const AssetSchema = z.object({
  category: z.enum(["equity", "debt", "gold", "cash", "real_estate", "other"]),
  subCategory: z.string().max(100).optional(),
  name: z.string().min(1).max(200),
  value: z.number().min(0),
});

const LiabilitySchema = z.object({
  name: z.string().min(1).max(200),
  value: z.number().min(0),
  monthlyEmi: z.number().min(0).optional(),
});

const GoalSchema = z.object({
  category: z.string().max(100),
  name: z.string().min(1).max(200),
  targetAmount: z.number().min(0),
  targetYears: z.number().int().min(1).max(100),
  inflationRate: z.number().min(0).max(100),
  expectedReturn: z.number().min(0).max(100),
  currentValue: z.number().min(0).optional(),
  existingMonthlySip: z.number().min(0).optional(),
  futureValue: z.number().min(0).optional(),
  requiredMonthlySip: z.number().min(0).optional(),
  additionalMonthlySip: z.number().min(0).optional(),
  gapAmount: z.number().min(0).optional(),
});

const RecommendationSchema = z.object({
  category: z.enum(["emergency", "insurance", "goals", "investment", "general"]),
  action: z.string().min(1).max(1000),
  priority: z.enum(["high", "medium", "low"]),
  notes: z.string().max(2000).optional(),
});

const UpdateBody = z.object({
  status: z.enum(["draft", "finalized"]).optional(),
  clientAge: z.number().int().min(0).max(120).optional().nullable(),
  spouseAge: z.number().int().min(0).max(120).optional().nullable(),
  childrenDetails: z.array(ChildDetailSchema).optional(),
  
  monthlyIncome: z.number().min(0).optional().nullable(),
  monthlyExpenses: z.number().min(0).optional().nullable(),
  
  assets: z.array(AssetSchema).optional(),
  liabilities: z.array(LiabilitySchema).optional(),
  
  emergencyFundTargetMonths: z.number().int().min(1).max(36).optional(),
  emergencyFundCurrentValue: z.number().min(0).optional(),
  
  lifeInsuranceSumAssured: z.number().min(0).optional().nullable(),
  lifeInsuranceAnnualPremium: z.number().min(0).optional().nullable(),
  
  healthInsuranceSumAssured: z.number().min(0).optional().nullable(),
  healthInsuranceAnnualPremium: z.number().min(0).optional().nullable(),
  
  goals: z.array(GoalSchema).optional(),
  
  recommendedEquityPct: z.number().int().min(0).max(100).optional(),
  recommendedDebtPct: z.number().int().min(0).max(100).optional(),
  recommendedGoldPct: z.number().int().min(0).max(100).optional(),
  recommendedCashPct: z.number().int().min(0).max(100).optional(),
  
  recommendations: z.array(RecommendationSchema).optional(),
  notes: z.string().optional().nullable(),
  riskProfile: z.string().optional().nullable(),
  savingsRate: z.number().min(0).max(100).optional().nullable(),
  emiToIncomePct: z.number().min(0).max(100).optional().nullable(),
  mfdValueAddText: z.string().optional().nullable(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireSession();
    requireCap(session.roles, "financial_plan.view", session.permissions);
    const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "compliance.view", session.permissions);

    const row = await withTenant(session.tenantId, async (tx) => {
      const p = await tx
        .select()
        .from(financialPlans)
        .where(and(eq(financialPlans.id, id), eq(financialPlans.tenantId, session.tenantId)))
        .limit(1);

      if (p.length === 0) return null;
      // Non-managers only see plans they prepared.
      if (!seesAll && p[0].preparedByUserId !== session.userId) return null;

      // Subject is either an investor (client) or a lead (prospect).
      let investor = null as any, lead = null as any;
      if (p[0].investorId) {
        investor = (await tx
          .select({ id: investors.id, name: investors.name, email: investors.email, phone: investors.phone, pan: investors.pan })
          .from(investors)
          .where(eq(investors.id, p[0].investorId))
          .limit(1))[0] ?? null;
      } else if (p[0].leadId) {
        lead = (await tx
          .select({ id: leads.id, name: leads.name, email: leads.email, phone: leads.phone })
          .from(leads)
          .where(eq(leads.id, p[0].leadId))
          .limit(1))[0] ?? null;
      }

      return { plan: p[0], investor, lead };
    });

    if (!row) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    return NextResponse.json(row);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireSession();
    requireCap(session.roles, "financial_plan.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "compliance.view", session.permissions);

    const body = await req.json().catch(() => ({}));
    const parse = UpdateBody.safeParse(body);
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }
    const data = parse.data;
    const clientMeta = clientMetaFromHeaders(req.headers);

    await withTenant(session.tenantId, async (tx) => {
      const existing = await tx
        .select()
        .from(financialPlans)
        .where(and(eq(financialPlans.id, id), eq(financialPlans.tenantId, session.tenantId)))
        .limit(1);

      if (existing.length === 0) {
        throw Object.assign(new Error("not found"), { status: 404 });
      }
      // Non-managers may only edit plans they prepared.
      if (!seesAll && existing[0].preparedByUserId !== session.userId) {
        throw Object.assign(new Error("you can only edit plans you prepared"), { status: 403 });
      }

      const updateValues: any = {};
      if (data.status !== undefined) updateValues.status = data.status;
      if (data.clientAge !== undefined) updateValues.clientAge = data.clientAge;
      if (data.spouseAge !== undefined) updateValues.spouseAge = data.spouseAge;
      if (data.childrenDetails !== undefined) updateValues.childrenDetails = data.childrenDetails;
      if (data.monthlyIncome !== undefined) updateValues.monthlyIncome = numOrNull(data.monthlyIncome);
      if (data.monthlyExpenses !== undefined) updateValues.monthlyExpenses = numOrNull(data.monthlyExpenses);
      if (data.assets !== undefined) updateValues.assets = data.assets;
      if (data.liabilities !== undefined) updateValues.liabilities = data.liabilities;
      if (data.emergencyFundTargetMonths !== undefined) updateValues.emergencyFundTargetMonths = data.emergencyFundTargetMonths;
      if (data.emergencyFundCurrentValue !== undefined) updateValues.emergencyFundCurrentValue = numOrNull(data.emergencyFundCurrentValue) ?? "0";
      if (data.lifeInsuranceSumAssured !== undefined) updateValues.lifeInsuranceSumAssured = numOrNull(data.lifeInsuranceSumAssured);
      if (data.lifeInsuranceAnnualPremium !== undefined) updateValues.lifeInsuranceAnnualPremium = numOrNull(data.lifeInsuranceAnnualPremium);
      if (data.healthInsuranceSumAssured !== undefined) updateValues.healthInsuranceSumAssured = numOrNull(data.healthInsuranceSumAssured);
      if (data.healthInsuranceAnnualPremium !== undefined) updateValues.healthInsuranceAnnualPremium = numOrNull(data.healthInsuranceAnnualPremium);
      // Recompute goal FV + required SIP server-side (authoritative).
      if (data.goals !== undefined) updateValues.goals = recomputePlanGoals(data.goals);
      if (data.recommendedEquityPct !== undefined) updateValues.recommendedEquityPct = data.recommendedEquityPct;
      if (data.recommendedDebtPct !== undefined) updateValues.recommendedDebtPct = data.recommendedDebtPct;
      if (data.recommendedGoldPct !== undefined) updateValues.recommendedGoldPct = data.recommendedGoldPct;
      if (data.recommendedCashPct !== undefined) updateValues.recommendedCashPct = data.recommendedCashPct;
      if (data.recommendations !== undefined) updateValues.recommendations = data.recommendations;
      if (data.notes !== undefined) updateValues.notes = data.notes;
      if (data.riskProfile !== undefined) updateValues.riskProfile = data.riskProfile;
      if (data.savingsRate !== undefined) updateValues.savingsRate = numOrNull(data.savingsRate);
      if (data.emiToIncomePct !== undefined) updateValues.emiToIncomePct = numOrNull(data.emiToIncomePct);
      if (data.mfdValueAddText !== undefined) updateValues.mfdValueAddText = data.mfdValueAddText;

      updateValues.updatedAt = new Date();

      await tx
        .update(financialPlans)
        .set(updateValues)
        .where(and(eq(financialPlans.id, id), eq(financialPlans.tenantId, session.tenantId)));

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "financial_plan.update",
        entityType: "financial_plan",
        entityId: id,
        before: { status: existing[0].status },
        after: { status: data.status ?? existing[0].status },
        ...clientMeta,
      });
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireSession();
    requireCap(session.roles, "financial_plan.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "compliance.view", session.permissions);
    const clientMeta = clientMetaFromHeaders(req.headers);

    await withTenant(session.tenantId, async (tx) => {
      const existing = await tx
        .select()
        .from(financialPlans)
        .where(and(eq(financialPlans.id, id), eq(financialPlans.tenantId, session.tenantId)))
        .limit(1);

      if (existing.length === 0) {
        throw Object.assign(new Error("not found"), { status: 404 });
      }
      // Permanent delete — non-managers may only delete plans they prepared.
      if (!seesAll && existing[0].preparedByUserId !== session.userId) {
        throw Object.assign(new Error("you can only delete plans you prepared"), { status: 403 });
      }

      await tx.delete(financialPlans).where(and(eq(financialPlans.id, id), eq(financialPlans.tenantId, session.tenantId)));

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "financial_plan.delete",
        entityType: "financial_plan",
        entityId: id,
        before: { planNumber: existing[0].planNumber },
        ...clientMeta,
      });
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
