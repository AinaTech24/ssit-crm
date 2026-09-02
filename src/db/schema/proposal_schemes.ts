/**
 * Per-line proposal scheme rows.
 *
 * Each proposal can carry many scheme line-items. We keep a normalised
 * table (in addition to the jsonb lineItems on `proposals`) so we can:
 *   - join schemes against AMC empanelment / commission slabs
 *   - flag and audit suitability per scheme (not just per proposal)
 *   - report at scheme level ("Top 10 funds proposed this quarter")
 */

import { index, numeric, pgTable, text, integer, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { proposals } from "./proposals";

export const proposalSchemes = pgTable(
  "proposal_schemes",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    proposalId: uuid("proposal_id").notNull().references(() => proposals.id, { onDelete: "cascade" }),

    amc: text("amc"),
    schemeName: text("scheme_name").notNull(),
    schemeCode: text("scheme_code"),
    schemeCategory: text("scheme_category"),
    assetClass: text("asset_class"),
    /** AMFI riskometer rating: low / moderate / high / very_high */
    schemeRiskLevel: text("scheme_risk_level"),

    sipAmount: numeric("sip_amount", { precision: 14, scale: 2 }),
    lumpsumAmount: numeric("lumpsum_amount", { precision: 14, scale: 2 }),
    expectedReturnPct: numeric("expected_return_pct", { precision: 5, scale: 2 }),
    expectedHoldingYears: integer("expected_holding_years"),

    /** aligned | warning | overridden — drives the audit banner */
    suitabilityStatus: text("suitability_status").notNull().default("aligned"),
    overrideReason: text("override_reason"),

    /**
     * Network FP "3.6 Product Recommendation" parity (migration 0029).
     * One of 4 modes per row: sip / lumpsum / swp / stp.
     */
    recommendationType: text("recommendation_type", {
      enum: ["sip", "lumpsum", "swp", "stp"],
    }).default("sip"),
    planType: text("plan_type", { enum: ["regular", "direct"] }),
    stepUpPct: numeric("step_up_pct", { precision: 5, scale: 2 }),
    goalOrObjective: text("goal_or_objective"),

    // SWP fields
    corpusRequired: numeric("corpus_required", { precision: 18, scale: 2 }),
    monthlyWithdrawal: numeric("monthly_withdrawal", {
      precision: 18,
      scale: 2,
    }),
    swpPeriodMonths: integer("swp_period_months"),

    // STP fields — transfers FROM scheme_name TO to_scheme_name
    toSchemeName: text("to_scheme_name"),
    toSchemeCode: text("to_scheme_code"),
    monthlyTransfer: numeric("monthly_transfer", { precision: 18, scale: 2 }),
    numInstallments: integer("num_installments"),
    totalCorpusForStp: numeric("total_corpus_for_stp", {
      precision: 18,
      scale: 2,
    }),
    ...timestamps,
  },
  (t) => ({
    proposalIdx: index("proposal_schemes_proposal_idx").on(t.proposalId),
    suitabilityIdx: index("proposal_schemes_suitability_idx").on(t.tenantId, t.suitabilityStatus),
  })
);

export type ProposalScheme = typeof proposalSchemes.$inferSelect;
