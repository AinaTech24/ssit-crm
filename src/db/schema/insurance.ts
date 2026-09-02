import {
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { branches } from "./branches";
import { investors } from "./investors";
import { users } from "./users";

/**
 * Insurance Policy register — one row per policy the client owns.
 *
 * Covers term / ULIP / endowment / health / motor / travel / home etc.
 * A policy can optionally be linked back to the proposal that recommended
 * it, so we can measure proposal → conversion.
 */

export const POLICY_TYPES = [
  "term",
  "ulip",
  "endowment",
  "money_back",
  "health",
  "critical_illness",
  "personal_accident",
  "motor",
  "travel",
  "home",
  "life_other",
  "general_other",
  // Commercial / general lines (Finowise MIS taxonomy).
  "fire",
  "marine",
  "burglary",
  "workmen_comp",
  "group_personal_accident",
  "group_health",
] as const;

export const POLICY_STATUSES = [
  "proposed",
  "in_underwriting",
  "active",
  "lapsed",
  "matured",
  "surrendered",
  "cancelled",
  "claim_filed",
  "claim_settled",
] as const;

export const PREMIUM_FREQUENCIES = [
  "single",
  "annual",
  "semi_annual",
  "quarterly",
  "monthly",
] as const;

export const insurancePolicies = pgTable(
  "insurance_policies",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    branchId: uuid("branch_id").references(() => branches.id),

    investorId: uuid("investor_id")
      .notNull()
      .references(() => investors.id),

    /** Optional link back to the proposal that recommended this policy. */
    sourceProposalId: uuid("source_proposal_id"),

    /** Insurer-issued policy number — unique per tenant once issued. */
    policyNumber: text("policy_number"),
    insurer: text("insurer").notNull(),
    /** "HDFC Life Click 2 Protect Super", "Star Health Comprehensive", etc. */
    planName: text("plan_name").notNull(),
    policyType: text("policy_type", { enum: POLICY_TYPES }).notNull(),

    /** Lives covered — for family floater health plans. */
    livesCovered: integer("lives_covered").default(1),

    sumAssured: numeric("sum_assured", { precision: 16, scale: 2 }),
    annualPremium: numeric("annual_premium", { precision: 14, scale: 2 }),
    premiumFrequency: text("premium_frequency", { enum: PREMIUM_FREQUENCIES })
      .notNull()
      .default("annual"),
    premiumPayingTermYears: integer("premium_paying_term_years"),
    policyTermYears: integer("policy_term_years"),

    policyStartDate: date("policy_start_date"),
    riskCoverStartDate: date("risk_cover_start_date"),
    maturityDate: date("maturity_date"),
    lastPremiumDate: date("last_premium_date"),
    nextPremiumDueDate: date("next_premium_due_date"),
    gracePeriodDays: integer("grace_period_days").default(30),

    /** Nominee for life-insurance policies. */
    nomineeName: text("nominee_name"),
    nomineeRelation: text("nominee_relation"),
    nomineeDob: date("nominee_dob"),
    nomineeShare: integer("nominee_share").default(100),

    riders: jsonb("riders").$type<Array<{ name: string; sumAssured?: number; premium?: number }>>().default([]),
    documents: jsonb("documents").$type<Array<{ name: string; url: string; uploadedAt?: string }>>().default([]),

    /**
     * Category-specific extras the fixed columns don't model — keyed off the
     * policy type's category (life / health / motor / general). Examples:
     *   motor   → { vehicleRegNo, makeModel, idv, ncbPercent, coverType }
     *   health  → { roomRentCapInr, coPayPercent, preExistingWaitingMonths }
     *   general → { coverageNotes }
     * Plus cross-category fields: businessType (new|renewal|portability) and
     * proposerName / proposerPan when the proposer differs from the holder.
     * Also the landing spot for AI policy-document auto-fill. Kept in JSONB so
     * adding a category never needs a migration.
     */
    details: jsonb("details").$type<Record<string, unknown>>().default({}),

    /** Free-form remarks — surrender values, claim notes, etc. */
    remarks: text("remarks"),
    /** When the policy lapses or is surrendered, capture the reason. */
    lapseReason: text("lapse_reason"),
    surrenderValue: numeric("surrender_value", { precision: 14, scale: 2 }),

    /**
     * Commission paid out for this policy (often 1-time + trail). NOTE: despite
     * the legacy `commission_paisa` column name, this is stored in RUPEES
     * (numeric, 2dp) — not paisa. Currently not populated by the create route.
     */
    commissionPaisa: numeric("commission_paisa", { precision: 14, scale: 2 }),

    status: text("status", { enum: POLICY_STATUSES }).notNull().default("active"),
    soldByUserId: uuid("sold_by_user_id").references(() => users.id),
    soldAt: timestamp("sold_at", { withTimezone: true }),

    /** Set once when the scanner emits `insurance.lapsed`, so it alerts only
     *  once per policy instead of every day past grace. */
    lapseAlertedAt: timestamp("lapse_alerted_at", { withTimezone: true }),

    ...timestamps,
  },
  (t) => ({
    investorIdx: index("ins_investor_idx").on(t.tenantId, t.investorId),
    statusIdx: index("ins_status_idx").on(t.tenantId, t.status),
    typeIdx: index("ins_type_idx").on(t.tenantId, t.policyType),
    nextPremIdx: index("ins_next_prem_idx").on(t.tenantId, t.nextPremiumDueDate),
    policyNumIdx: index("ins_policy_num_idx").on(t.tenantId, t.policyNumber),
  })
);

export type InsurancePolicy = typeof insurancePolicies.$inferSelect;
export type NewInsurancePolicy = typeof insurancePolicies.$inferInsert;
