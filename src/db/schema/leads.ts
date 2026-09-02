import { index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";
import { branches } from "./branches";

export const leads = pgTable(
  "leads",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    branchId: uuid("branch_id").references(() => branches.id),

    name: text("name").notNull(),
    email: text("email"),
    emailNormalized: text("email_normalized"),
    phone: text("phone"),
    phoneNormalized: text("phone_normalized"),
    pan: text("pan"),
    city: text("city"),
    pincode: text("pincode"),

    /** Optional lead photo — storage key (S3 general/ kind) or external URL;
     *  served via /api/leads/[id]/avatar. Never mandatory. */
    avatarUrl: text("avatar_url"),

    /**
     * Lead source — per spec §6 Module 3:
     *   Referral · Website · Social Media · Webinar · Seminar · Walk-in
     *   Existing Client Reference · Google · Cold Call · Other
     * Legacy values (meta_ads, google_ads, linkedin, youtube, event, manual)
     * are kept for backward compatibility with already-imported leads.
     */
    source: text("source", {
      enum: [
        // Spec-canonical
        "referral",
        "website",
        "social_media",
        "webinar",
        "seminar",
        "walk_in",
        "existing_client",
        "google",
        "cold_call",
        "other",
        // Legacy / sub-source — kept for back-compat
        "meta_ads",
        "google_ads",
        "linkedin",
        "youtube",
        "event",
        "manual",
      ],
    })
      .notNull()
      .default("manual"),
    sourceCampaign: text("source_campaign"),
    utmParams: jsonb("utm_params").$type<{
      source?: string;
      medium?: string;
      campaign?: string;
      term?: string;
      content?: string;
    }>(),

    /**
     * Lead stage — per spec §6 Module 3:
     *   New · Contacted · Meeting Scheduled · Proposal Shared · Follow-Up
     *   Converted · Lost · Not Interested
     * Legacy values (qualified ≈ Meeting Scheduled, proposal_sent ≈ Proposal Shared,
     * cold ≈ Not Interested) are kept for back-compat with already-stored leads.
     */
    stage: text("stage", {
      enum: [
        // Spec-canonical
        "new",
        "contacted",
        "meeting_scheduled",
        "meeting_done",
        "risk_profile_sent",
        "risk_profiled",
        "proposal_drafted",
        "proposal_shared",
        "proposal_approved",
        "docs_requested",
        "docs_received",
        "follow_up",
        "converted",
        "lost",
        "not_interested",
        // SOP Blueprint stages (lead + client phase)
        "call_done",
        "call_back_later",
        "call_not_connected",
        "contact_in_future",
        "meeting_pending",
        "won_lead",
        "not_qualified",
        "request_documents",
        "documents_pending",
        "documents_received",
        "kyc_validated",
        "kyc_registered",
        "kyc_pending",
        "modify_kyc",
        "physical_kyc",
        "online_kyc",
        "ucc_create",
        "ucc_activated",
        "mandate_create",
        "mandate_activated",
        "mandate_reject",
        "mandate_rejected",
        "make_transaction",
        "transaction_successful",
        "transaction_failed",
        "family_mapping",
        "update_information",
        "add_in_review_sheet",
        // Legacy aliases
        "qualified",
        "proposal_sent",
        "cold",
      ],
    })
      .notNull()
      .default("new"),
    stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }),
    /** Multiple-pipelines (Zoho parity): which sales process this lead runs in
     *  (mf | insurance | general) + its stage within that pipeline. Separate
     *  from the blueprint `stage` above. See src/lib/pipelines/config.ts. */
    pipeline: text("pipeline").notNull().default("mf"),
    pipelineStage: text("pipeline_stage"),
    /** Legacy free-text score (AI-advisory; not reliably populated). Kept for
     *  back-compat — the structured columns below are the source of truth. */
    score: text("score").default("0"),
    /** Deterministic scorecard output (0–100) — see src/lib/leads/score.ts. */
    leadScore: integer("lead_score").notNull().default(0),
    /** Band derived from leadScore: hot | warm | cold. */
    scoreBand: text("score_band").notNull().default("cold"),
    /** When leadScore was last (re)computed. NULL ⇒ never scored. */
    scoredAt: timestamp("scored_at", { withTimezone: true }),

    interestProducts: jsonb("interest_products").$type<string[]>().default([]),
    /** Legacy free-text "intended investment" — kept populated (from
     *  expectedBusinessAmount) for back-compat scoring + old readers. The
     *  numeric column below is the canonical pipeline value. */
    intendedAmount: text("intended_amount"),

    /**
     * Canonical pipeline value in rupees — what this lead is expected to bring
     * if converted. Drives the "Pipeline value" KPI + forecasting + scoring.
     * Backfilled from intended_amount in migration 0052.
     */
    expectedBusinessAmount: numeric("expected_business_amount", { precision: 16, scale: 2 }),
    /** Coarse AUM-potential band for one-click segmentation. */
    aumPotential: text("aum_potential", {
      enum: ["under_10l", "10l_50l", "50l_2cr", "hni_2cr_plus"],
    }),
    /** Lead classification — drives routing, segmentation, scoring inputs. */
    leadType: text("lead_type", {
      enum: ["individual", "hni", "nri", "corporate", "minor"],
    }),
    /** Qualification context the RM gathers up-front: occupation + what the
     *  lead already holds elsewhere (for the pitch). JSONB so it can grow. */
    profile: jsonb("profile").$type<{ occupation?: string; currentInvestments?: string[] }>().default({}),
    // MFD-defined custom fields (migration 0166) — keyed by custom_field_defs.key.
    customFields: jsonb("custom_fields").$type<Record<string, any>>(),
    /** Secondary contact points (work vs personal). Primary stays in
     *  phone/email so dedup via the normalized columns keeps working. */
    altPhone: text("alt_phone"),
    altEmail: text("alt_email"),

    /** Optional referral chain — populated when source = 'existing_client' or 'referral' */
    referredByInvestorId: uuid("referred_by_investor_id"),
    referredByName: text("referred_by_name"),
    /**
     * When sourced via a sub-distributor / channel partner — drives
     * commission attribution at conversion. Nullable; FK added in
     * migration 0019.
     */
    subDistributorId: uuid("sub_distributor_id"),

    ownerId: uuid("owner_id").references(() => users.id),
    lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
    lastFollowUpAt: timestamp("last_follow_up_at", { withTimezone: true }),
    nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),
    convertedInvestorId: uuid("converted_investor_id"),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    lostReason: text("lost_reason"),
    lostAt: timestamp("lost_at", { withTimezone: true }),

    /** Free-text follow-up notes (latest goes to top). For the full history we
     *  rely on the communications table; this is the quick "what's the state". */
    followUpNotes: text("follow_up_notes"),

    notes: text("notes"),
    tags: jsonb("tags").$type<string[]>().default([]),

    /** Raw KYC submission captured from the public onboarding link (/d/<token>)
     *  while this is still a lead. Copied onto the new investor's client master
     *  on conversion (see /api/leads/[id]/convert). Migration 0130. */
    kycData: jsonb("kyc_data").$type<Record<string, string>>(),

    ...timestamps,
  },
  (t) => ({
    stageIdx: index("leads_stage_idx").on(t.tenantId, t.stage),
    scoreIdx: index("leads_score_idx").on(t.tenantId, t.leadScore),
    ownerIdx: index("leads_owner_idx").on(t.tenantId, t.ownerId),
    nextFollowUpIdx: index("leads_next_fu_idx").on(t.tenantId, t.nextFollowUpAt),
    phoneNormIdx: index("leads_phone_norm_idx").on(t.tenantId, t.phoneNormalized),
    emailNormIdx: index("leads_email_norm_idx").on(t.tenantId, t.emailNormalized),
    panIdx: index("leads_pan_idx").on(t.tenantId, t.pan),
    leadTypeIdx: index("leads_type_idx").on(t.tenantId, t.leadType),
  })
);

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
