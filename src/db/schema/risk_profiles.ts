/**
 * Risk Profile Responses — spec § 6 Module 7.
 *
 * Each row is one completed questionnaire for one investor. The latest row
 * per investor is the "current" risk profile. Historical rows are kept
 * indefinitely so we can show the investor's risk drift over time and
 * satisfy SEBI inspection.
 *
 * The `investors.riskProfile` + `riskProfileSignedAt` columns mirror the
 * latest row's `finalCategory` + `signedAt` for fast lookups (sidebars,
 * filters) without joining this table everywhere.
 */

import { date, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";

export const riskProfileResponses = pgTable(
  "risk_profile_responses",
  {
    id,
    tenantId,
    investorId: uuid("investor_id").notNull(),

    /** Profile date — when the questionnaire was completed. */
    profileDate: date("profile_date").notNull().defaultNow(),

    /** Captured-at-time-of-questionnaire facts. Don't update from investor row. */
    age: integer("age"),

    /** ─── 8 spec questions (canonical answer slug + score) ─── */
    investmentHorizon: text("investment_horizon", {
      enum: ["under_1yr", "1_to_3yr", "3_to_5yr", "5_to_10yr", "over_10yr"],
    }),
    incomeStability: text("income_stability", {
      enum: ["variable", "moderate", "stable", "highly_stable"],
    }),
    riskCapacity: text("risk_capacity", {
      enum: ["very_low", "low", "medium", "high", "very_high"],
    }),
    riskTolerance: text("risk_tolerance", {
      enum: ["sell_all", "sell_some", "hold", "hold_buy_more", "buy_aggressively"],
    }),
    investmentObjective: text("investment_objective", {
      enum: ["capital_preservation", "regular_income", "balanced_growth", "long_term_growth", "aggressive_growth"],
    }),
    mfExperience: text("mf_experience", {
      enum: ["none", "less_than_2yr", "2_to_5yr", "5_to_10yr", "over_10yr"],
    }),
    netWorthBand: text("net_worth_band", {
      enum: ["under_10L", "10L_to_50L", "50L_to_1Cr", "1Cr_to_5Cr", "over_5Cr"],
    }),

    /** Computed final category + total. */
    finalCategory: text("final_category", { enum: ["conservative", "moderate", "aggressive", "very_aggressive"] }).notNull(),
    totalScore: integer("total_score").notNull(),

    /** Full per-question payload — store everything for audit. */
    responses: jsonb("responses").$type<Array<{ key: string; question: string; answer: string; score: number }>>(),

    /** Signed PDF / scanned form. */
    documentUrl: text("document_url"),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    signedByName: text("signed_by_name"),
    /** Annual review — auto-set to signedAt + 365d when missing. */
    nextReviewAt: date("next_review_at"),

    // rm_entry        — the RM keyed the answers in.
    // client_otp       — client submitted AND an OTP was verified server-side.
    // client_physical  — captured from a physically-signed form.
    // client_link      — client self-submitted via a secure single-use link
    //                    (token is the credential; NO OTP verification). Don't
    //                    record client_otp for this path — it would overclaim.
    verificationMethod: text("verification_method", {
      enum: ["rm_entry", "client_otp", "client_physical", "client_link"],
    }).notNull().default("rm_entry"),
    otpTransactionId: text("otp_transaction_id"),
    /** Email-OTP proof (client self-submission): the address that received and
     *  confirmed the 6-digit code, and when it was verified. */
    verifiedEmail: text("verified_email"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    clientIp: text("client_ip"),
    clientUserAgent: text("client_user_agent"),

    rmRemarks: text("rm_remarks"),
    createdById: uuid("created_by_id"),

    ...timestamps,
  },
  (t) => ({
    investorLatestIdx: index("rpr_investor_signed_idx").on(t.tenantId, t.investorId, t.signedAt),
    nextReviewIdx: index("rpr_next_review_idx").on(t.tenantId, t.nextReviewAt),
    categoryIdx: index("rpr_category_idx").on(t.tenantId, t.finalCategory),
  })
);

export type RiskProfileResponse = typeof riskProfileResponses.$inferSelect;
export type NewRiskProfileResponse = typeof riskProfileResponses.$inferInsert;
