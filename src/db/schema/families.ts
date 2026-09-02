import { date, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { branches } from "./branches";

/**
 * Family group — per spec § 6 Module 5.
 *
 * `headName` is kept for back-compat (legacy display label) but the spec-
 * canonical fields are:
 *   - familyName              — display name like "Mehta Family"
 *   - primaryInvestorId       — pointer to the primary / head investor
 *   - rmId                    — family-level RM (often the primary's RM)
 *   - lastReviewAt / nextReviewAt — family review cadence
 *
 * The member list + relationships live on `investors.familyId` + `familyRole`.
 */
export const families = pgTable("families", {
  id,
  tenantId: tenantId.references(() => tenants.id),
  branchId: uuid("branch_id").references(() => branches.id),

  /** Legacy display label — still the source-of-truth for old rows. */
  headName: text("head_name").notNull(),
  /** Spec-canonical family name. Falls back to headName when null. */
  familyName: text("family_name"),

  /** Head of the family (primary client). NULL until linked. */
  primaryInvestorId: uuid("primary_investor_id"),

  /** Family-level RM — defaults to primary client's RM but can be overridden. */
  rmId: uuid("rm_id"),

  /** Short human-friendly reference code, e.g. "MEHTA-001" (optional). */
  familyCode: text("family_code"),
  /** Household segment — mirrors investor.segmentTag for prioritisation. */
  familyCategory: text("family_category", {
    enum: ["HNI", "Affluent", "Retail", "NRI", "Corporate"],
  }),
  /** Household review cadence (Sanchay "Meeting Frequency"). Drives nextReviewAt. */
  reviewFrequency: text("review_frequency", {
    enum: ["monthly", "quarterly", "half_yearly", "annual"],
  }),
  /** Anchor for the review cadence — the first household meeting. */
  firstMeetingDate: date("first_meeting_date"),

  /** Family review cadence. Used by "Family review due" report + dashboards. */
  lastReviewAt: timestamp("last_review_at", { withTimezone: true }),
  nextReviewAt: timestamp("next_review_at", { withTimezone: true }),

  /** Persisted family-health scorecard (src/lib/families/health.ts) — written
   *  on member-link/unlink + family/member edits, refreshed nightly. Lets the
   *  list sort/filter "worst families first" and drives segments/automations. */
  healthScore: integer("health_score").notNull().default(100),
  healthBand: text("health_band", { enum: ["green", "amber", "red"] }).notNull().default("green"),
  healthScoredAt: timestamp("health_scored_at", { withTimezone: true }),

  notes: text("notes"),
  tags: jsonb("tags").$type<string[]>().default([]),
  ...timestamps,
}, (t) => ({
  rmIdx: index("families_rm_idx").on(t.tenantId, t.rmId),
  nextReviewIdx: index("families_next_review_idx").on(t.tenantId, t.nextReviewAt),
  primaryIdx: index("families_primary_idx").on(t.tenantId, t.primaryInvestorId),
  healthIdx: index("families_health_idx").on(t.tenantId, t.healthScore),
}));

export type Family = typeof families.$inferSelect;
export type NewFamily = typeof families.$inferInsert;
