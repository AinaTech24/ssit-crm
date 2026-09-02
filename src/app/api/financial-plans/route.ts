import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { financialPlans, investors, leads } from "@/db/schema";
import { handleApiError } from "@/lib/api/error-handler";
import { recomputePlanGoals, numOrNull } from "@/lib/financial-plans/compute";

export const dynamic = "force-dynamic";

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

const CreateBody = z.object({
  // A plan's subject is EITHER an existing client (investorId) OR a lead/prospect
  // (leadId) — exactly one (enforced by .refine below + a DB CHECK constraint).
  investorId: z.string().uuid().optional().nullable(),
  leadId: z.string().uuid().optional().nullable(),
  status: z.enum(["draft", "finalized"]).default("draft"),
  clientAge: z.number().int().min(0).max(120).optional().nullable(),
  spouseAge: z.number().int().min(0).max(120).optional().nullable(),
  childrenDetails: z.array(ChildDetailSchema).default([]),
  
  monthlyIncome: z.number().min(0).optional().nullable(),
  monthlyExpenses: z.number().min(0).optional().nullable(),
  
  assets: z.array(AssetSchema).default([]),
  liabilities: z.array(LiabilitySchema).default([]),
  
  emergencyFundTargetMonths: z.number().int().min(1).max(36).default(6),
  emergencyFundCurrentValue: z.number().min(0).default(0),
  
  lifeInsuranceSumAssured: z.number().min(0).optional().nullable(),
  lifeInsuranceAnnualPremium: z.number().min(0).optional().nullable(),
  
  healthInsuranceSumAssured: z.number().min(0).optional().nullable(),
  healthInsuranceAnnualPremium: z.number().min(0).optional().nullable(),
  
  goals: z.array(GoalSchema).default([]),
  
  recommendedEquityPct: z.number().int().min(0).max(100).default(0),
  recommendedDebtPct: z.number().int().min(0).max(100).default(0),
  recommendedGoldPct: z.number().int().min(0).max(100).default(0),
  recommendedCashPct: z.number().int().min(0).max(100).default(0),
  
  recommendations: z.array(RecommendationSchema).default([]),
  notes: z.string().optional().nullable(),
  riskProfile: z.string().optional().nullable(),
  savingsRate: z.number().min(0).max(100).optional().nullable(),
  emiToIncomePct: z.number().min(0).max(100).optional().nullable(),
  mfdValueAddText: z.string().optional().nullable(),
}).refine((d) => !!d.investorId !== !!d.leadId, {
  message: "Provide exactly one of investorId or leadId",
  path: ["investorId"],
});

async function nextPlanNumber(tx: any, tenantId: string) {
  const year = new Date().getFullYear();
  const r = await tx.execute(sql`
    SELECT COALESCE(MAX(
      CASE WHEN plan_number ~ ('^FP-' || ${year}::text || '-[0-9]+$')
           THEN CAST(SUBSTRING(plan_number FROM 9) AS INTEGER)
           ELSE 0
      END
    ), 0)::int AS max_n
    FROM financial_plans
  `);
  const n = (r.rows[0] as any)?.max_n ?? 0;
  return `FP-${year}-${String(n + 1).padStart(4, "0")}`;
}

export async function GET() {
  try {
    const session = await requireSession();
    requireCap(session.roles, "financial_plan.view", session.permissions);
    // Financial plans hold the most sensitive client data (income, assets,
    // liabilities). Managers see all; everyone else only the plans they
    // prepared — financial_plan.view alone would otherwise let any holder
    // (incl. marketing) read every client's full financials.
    const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "compliance.view", session.permissions);

    const rows = await withTenant(session.tenantId, async (tx) =>
      tx
        .select({
          id: financialPlans.id,
          planNumber: financialPlans.planNumber,
          investorId: financialPlans.investorId,
          leadId: financialPlans.leadId,
          status: financialPlans.status,
          clientAge: financialPlans.clientAge,
          monthlyIncome: financialPlans.monthlyIncome,
          monthlyExpenses: financialPlans.monthlyExpenses,
          preparedAt: financialPlans.preparedAt,
          createdAt: financialPlans.createdAt,
          investorName: investors.name,
          leadName: leads.name,
        })
        .from(financialPlans)
        .leftJoin(investors, eq(financialPlans.investorId, investors.id))
        .leftJoin(leads, eq(financialPlans.leadId, leads.id))
        .where(seesAll ? undefined : eq(financialPlans.preparedByUserId, session.userId))
        .orderBy(desc(financialPlans.createdAt))
        .limit(500)
    );

    return NextResponse.json({ plans: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "financial_plan.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const body = await req.json().catch(() => ({}));
    const parse = CreateBody.safeParse(body);
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }
    const data = parse.data;
    const id = uuid();
    const clientMeta = clientMetaFromHeaders(req.headers);

    await withTenant(session.tenantId, async (tx) => {
      if (data.leadId) {
        const leadExists = await tx.select({ id: leads.id }).from(leads).where(eq(leads.id, data.leadId)).limit(1);
        if (leadExists.length === 0) {
          throw Object.assign(new Error("Lead not found in this tenant context"), { status: 404 });
        }
      } else {
        const clientExists = await tx
          .select({ id: investors.id })
          .from(investors)
          .where(eq(investors.id, data.investorId!))
          .limit(1);
        if (clientExists.length === 0) {
          throw Object.assign(new Error("Client investor not found in this tenant context"), { status: 404 });
        }
      }

      const planNumber = await nextPlanNumber(tx, session.tenantId);

      await tx.insert(financialPlans).values({
        id,
        tenantId: session.tenantId,
        planNumber,
        investorId: data.investorId ?? null,
        leadId: data.leadId ?? null,
        status: data.status,
        clientAge: data.clientAge,
        spouseAge: data.spouseAge,
        childrenDetails: data.childrenDetails,
        monthlyIncome: numOrNull(data.monthlyIncome),
        monthlyExpenses: numOrNull(data.monthlyExpenses),
        assets: data.assets,
        liabilities: data.liabilities,
        emergencyFundTargetMonths: data.emergencyFundTargetMonths,
        emergencyFundCurrentValue: numOrNull(data.emergencyFundCurrentValue) ?? "0",
        lifeInsuranceSumAssured: numOrNull(data.lifeInsuranceSumAssured),
        lifeInsuranceAnnualPremium: numOrNull(data.lifeInsuranceAnnualPremium),
        healthInsuranceSumAssured: numOrNull(data.healthInsuranceSumAssured),
        healthInsuranceAnnualPremium: numOrNull(data.healthInsuranceAnnualPremium),
        // Recompute each goal's FV + required SIP server-side (authoritative).
        goals: recomputePlanGoals(data.goals),
        recommendedEquityPct: data.recommendedEquityPct,
        recommendedDebtPct: data.recommendedDebtPct,
        recommendedGoldPct: data.recommendedGoldPct,
        recommendedCashPct: data.recommendedCashPct,
        recommendations: data.recommendations,
        notes: data.notes,
        riskProfile: data.riskProfile,
        savingsRate: numOrNull(data.savingsRate),
        emiToIncomePct: numOrNull(data.emiToIncomePct),
        mfdValueAddText: data.mfdValueAddText,
        preparedByUserId: session.userId,
        preparedAt: new Date(),
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "financial_plan.create",
        entityType: "financial_plan",
        entityId: id,
        after: { planNumber, status: data.status },
        ...clientMeta,
      });
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
