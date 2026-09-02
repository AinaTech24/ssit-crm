import {
  integer,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { investors } from "./investors";
import { leads } from "./leads";
import { users } from "./users";

/**
 * Detailed Financial Plans module schema.
 * Allows MFDs to profile client finance, calculate surpluses, assets/liabilities,
 * analyze emergency/insurance gaps, set goals with inflation/SIP calculator,
 * and provide allocation recommendations.
 */
export const financialPlans = pgTable(
  "financial_plans",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    planNumber: text("plan_number").notNull(),
    // A plan belongs to EITHER an investor (client) OR a lead (prospect). The
    // DB CHECK constraint (migration 0160) enforces exactly one is set.
    investorId: uuid("investor_id").references(() => investors.id),
    leadId: uuid("lead_id").references(() => leads.id),
    status: text("status", { enum: ["draft", "finalized"] })
      .notNull()
      .default("draft"),
    
    // Profiling
    clientAge: integer("client_age"),
    spouseAge: integer("spouse_age"),
    childrenDetails: jsonb("children_details").$type<{ name: string; age: number }[]>().default([]),
    riskProfile: text("risk_profile"),

    // Cash flow
    monthlyIncome: numeric("monthly_income", { precision: 16, scale: 2 }),
    monthlyExpenses: numeric("monthly_expenses", { precision: 16, scale: 2 }),
    savingsRate: numeric("savings_rate", { precision: 5, scale: 2 }),
    emiToIncomePct: numeric("emi_to_income_pct", { precision: 5, scale: 2 }),

    // Net Worth Assets & Liabilities
    assets: jsonb("assets").$type<{
      category: "equity" | "debt" | "gold" | "cash" | "real_estate" | "other";
      subCategory?: string;
      name: string;
      value: number;
    }[]>().default([]),
    liabilities: jsonb("liabilities").$type<{
      name: string;
      value: number;
      monthlyEmi?: number;
    }[]>().default([]),

    // Emergency Fund & Insurance
    emergencyFundTargetMonths: integer("emergency_fund_target_months").default(6),
    emergencyFundCurrentValue: numeric("emergency_fund_current_value", { precision: 16, scale: 2 }).default("0"),
    
    lifeInsuranceSumAssured: numeric("life_insurance_sum_assured", { precision: 16, scale: 2 }),
    lifeInsuranceAnnualPremium: numeric("life_insurance_annual_premium", { precision: 16, scale: 2 }),
    
    healthInsuranceSumAssured: numeric("health_insurance_sum_assured", { precision: 16, scale: 2 }),
    healthInsuranceAnnualPremium: numeric("health_insurance_annual_premium", { precision: 16, scale: 2 }),

    // Goal planning (Inflation & SIP calculations)
    goals: jsonb("goals").$type<{
      category: string;
      name: string;
      targetAmount: number; // Current value cost
      targetYears: number;
      inflationRate: number;
      expectedReturn: number;
      /** Existing money already earmarked for THIS goal — nets down the SIP ask. */
      currentValue?: number;
      existingMonthlySip?: number;
      futureValue?: number;
      requiredMonthlySip?: number; // total required (gross)
      additionalMonthlySip?: number; // net of existing SIP — the real ask
      gapAmount?: number;
    }[]>().default([]),

    // Recommended Asset Allocation
    recommendedEquityPct: integer("recommended_equity_pct").default(0),
    recommendedDebtPct: integer("recommended_debt_pct").default(0),
    recommendedGoldPct: integer("recommended_gold_pct").default(0),
    recommendedCashPct: integer("recommended_cash_pct").default(0),

    // Recommendations list
    recommendations: jsonb("recommendations").$type<{
      category: "emergency" | "insurance" | "goals" | "investment" | "general";
      action: string;
      priority: "high" | "medium" | "low";
      notes?: string;
    }[]>().default([]),

    notes: text("notes"),
    mfdValueAddText: text("mfd_value_add_text"),


    // Metadata
    preparedByUserId: uuid("prepared_by_user_id").references(() => users.id),
    preparedAt: timestamp("prepared_at", { withTimezone: true }).defaultNow(),

    ...timestamps,
  },
  (t) => ({
    investorIdx: index("financial_plans_investor_idx").on(t.tenantId, t.investorId),
    leadIdx: index("financial_plans_lead_idx").on(t.tenantId, t.leadId),
    numberIdx: index("financial_plans_number_idx").on(t.tenantId, t.planNumber),
    statusIdx: index("financial_plans_status_idx").on(t.tenantId, t.status),
  })
);

export type FinancialPlan = typeof financialPlans.$inferSelect;
export type NewFinancialPlan = typeof financialPlans.$inferInsert;
