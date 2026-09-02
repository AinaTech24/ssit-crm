/**
 * Client Onboarding pipelines — spec § 6 Module 6.
 *
 * One row per investor undergoing onboarding. The 11 stages from the spec are
 * tracked via a single `stages` jsonb (keyed by stage slug → {doneAt, byUserId,
 * remarks}) plus a denormalised `currentStage` for fast kanban grouping.
 *
 * Stage progression rules (enforced in the API, not the DB):
 *   - Stages can be marked done out of order (some MFDs do KYC before risk profile)
 *   - `currentStage` is auto-advanced to the next not-yet-done stage when a
 *      stage is marked done.
 *   - `actualCompletionDate` is set when the last stage (`first_review`) is done.
 *
 * Per-stage status flags live on `investors` already (kycStatus, riskProfile,
 * mandateStatus, bseUccCode, etc.) — this table is the orchestration layer
 * that says "did the RM complete the action for this investor".
 */

import { date, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";

/** The 11 stages per spec, in canonical order. Keep keys lower_snake. */
export const ONBOARDING_STAGES = [
  "first_meeting",
  "documents",
  "kyc",
  "risk_profile",
  "goal_mapping",
  "ucc_can",
  "mandate",
  "plan_shared",
  "first_investment",
  "welcome_kit",
  "first_review",
] as const;

export type OnboardingStage = (typeof ONBOARDING_STAGES)[number];

/** Per-stage record kept inside the jsonb blob. */
export type OnboardingStageEntry = {
  doneAt: string; // ISO timestamp
  byUserId?: string;
  remarks?: string;
};

export const onboardingPipelines = pgTable(
  "onboarding_pipelines",
  {
    id,
    tenantId,
    /** One pipeline per investor (enforced by unique index). */
    investorId: uuid("investor_id").notNull(),
    branchId: uuid("branch_id"),
    assignedRmId: uuid("assigned_rm_id"),

    /** Active stage — the next thing the RM needs to do. */
    currentStage: text("current_stage", {
      enum: [...ONBOARDING_STAGES, "completed", "abandoned"],
    })
      .notNull()
      .default("first_meeting"),

    /** Stage history: { first_meeting: { doneAt, byUserId, remarks }, ... } */
    stages: jsonb("stages").$type<Record<string, OnboardingStageEntry>>().notNull().default({}),

    /** Pending documents — list of doc names the investor still owes. */
    pendingDocuments: jsonb("pending_documents").$type<string[]>().notNull().default([]),

    /** Target & actual completion. */
    expectedCompletionAt: date("expected_completion_at"),
    actualCompletionAt: date("actual_completion_at"),

    /** Lifecycle. */
    status: text("status", { enum: ["in_progress", "completed", "abandoned", "on_hold"] })
      .notNull()
      .default("in_progress"),
    onHoldReason: text("on_hold_reason"),

    remarks: text("remarks"),
    ...timestamps,
  },
  (t) => ({
    investorUnique: uniqueIndex("onboarding_investor_unique").on(t.tenantId, t.investorId),
    stageIdx: index("onboarding_stage_idx").on(t.tenantId, t.currentStage),
    rmIdx: index("onboarding_rm_idx").on(t.tenantId, t.assignedRmId),
  })
);

export type OnboardingPipeline = typeof onboardingPipelines.$inferSelect;
export type NewOnboardingPipeline = typeof onboardingPipelines.$inferInsert;
