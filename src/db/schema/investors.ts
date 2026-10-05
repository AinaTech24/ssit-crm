import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { branches } from "./branches";
import { families } from "./families";
import { users } from "./users";

export const investors = pgTable(
  "investors",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    branchId: uuid("branch_id").references(() => branches.id),
    familyId: uuid("family_id").references(() => families.id),
    familyRole: text("family_role"),

    // DB column is NULLABLE (migration 0129) — PAN is often captured after KYC
    // docs, so a lead can convert before the PAN is known. We keep the Drizzle
    // type non-null to avoid a `string | null` ripple across the app (PAN is
    // present for ~all investors); the only null-producer is PAN-less lead
    // conversion, which inserts via an `as any` cast.
    pan: text("pan").notNull(),
    name: text("name").notNull(),
    dob: date("dob"),
    gender: text("gender", { enum: ["M", "F", "O"] }),
    email: text("email"),
    phone: text("phone"),
    alternatePhone: text("alternate_phone"),
    whatsappPhone: text("whatsapp_phone"),

    /** Client photo — storage key (S3 general/ kind) or external URL; served
     *  via /api/investors/[id]/avatar. Optional. */
    avatarUrl: text("avatar_url"),

    /** Profile (used in client master + risk profile prefill). */
    occupation: text("occupation"), // matches master_values('occupation')
    incomeRange: text("income_range"), // matches master_values('income_range')
    employerName: text("employer_name"),
    address: jsonb("address").$type<{
      line1?: string;
      city?: string;
      state?: string;
      pincode?: string;
      country?: string;
    }>(),

    /**
     * Classification — per spec § 6 Module 4 Client Categories:
     *   Individual · HUF · NRI · Company · Trust · Minor
     * "company" is the spec label; "corporate" is the legacy DB value (kept).
     */
    investorCategory: text("investor_category", {
      enum: ["individual", "huf", "corporate", "company", "trust", "nri", "minor", "other"],
    })
      .notNull()
      .default("individual"),
    segmentTag: text("segment_tag", { enum: ["HNI", "Affluent", "Retail", "NRI", "Corporate"] }),

    /** Exchange-level identifiers (BSE Star MF UCC + NSE NMF II CAN) — read on
     *  every order placement; cached here for UI display without joining feeds. */
    bseUccCode: text("bse_ucc_code"),
    nseCanCode: text("nse_can_code"),
    /** Additional client codes (a client can hold several UCCs across BSE / NSE /
     *  MFU or multiple registrations). Free list, editable in the master form and
     *  importable. Migration 0178. */
    uccCodes: jsonb("ucc_codes").$type<string[]>().default([]),
    /** Per-platform client codes (migration 0206). The BOOK a client belongs to
     *  — Motilal Oswal / Mutual Fund — is a tag; these are the identifiers. */
    mfCode: text("mf_code"),
    moCode: text("mo_code"),
    bajajCode: text("bajaj_code"),
    lasCode: text("las_code"),
    mandateStatus: text("mandate_status", {
      enum: ["none", "pending", "active", "expired", "rejected", "cancelled"],
    }).default("none"),
    mandateRefNo: text("mandate_ref_no"),
    /** Max per-debit amount the registered NACH / e-mandate authorises.
     *  Captured when the team marks the mandate Activated. Migration 0131. */
    mandateAmount: numeric("mandate_amount", { precision: 18, scale: 2 }),

    /**
     * Service tier — drives review cadence + RM workload allocation.
     *   A = top 20% by AUM/revenue, quarterly reviews, RM dedicated
     *   B = mid 30%, half-yearly reviews
     *   C = long tail 50%, annual review + automated touchpoints only
     * Auto-computed nightly by tier-recomputer worker, manually overridable.
     */
    serviceTier: text("service_tier", { enum: ["A", "B", "C"] }),
    serviceTierLockedAt: timestamp("service_tier_locked_at", { withTimezone: true }),
    serviceTierManualOverride: boolean("service_tier_manual_override").default(false),

    /**
     * Client Category — a manually-assigned A/B/C/D classification the firm uses
     * to grade clients (e.g. A = key/premium … D = low-touch). Distinct from the
     * auto-computed `serviceTier` (A/B/C, review cadence) and `investorCategory`
     * (entity type). NULL = not yet categorised. Assigned in the client master
     * editor or in bulk from the client list.
     */
    clientCategory: text("client_category", { enum: ["A", "B", "C", "D"] }),

    /** Multi-tag client type used by RM dashboards.
     *  e.g. ['sip_investor', 'high_aum', 'review_due']. */
    clientTypes: jsonb("client_types").$type<string[]>().default([]),

    /** KYC */
    kycStatus: text("kyc_status", {
      enum: [
        "pending",
        "registered", // CERSAI-registered but not validated
        "verified", // CERSAI-validated
        "hold", // flagged for manual review
        "rejected",
        "expired",
        "re_kyc_required",
      ],
    })
      .notNull()
      .default("pending"),
    /** Name exactly as on PAN card — distinct from `name` (display). */
    nameAsPerPan: text("name_as_per_pan"),
    /** PAN-Aadhaar link status — SEBI mandate; without 'linked', new
     *  investments are blocked AMC-side. */
    panAadhaarLinkStatus: text("pan_aadhaar_link_status", {
      enum: ["linked", "not_linked", "pending", "not_applicable"],
    }),
    /** Granular residency status (more specific than investor_category's
     *  nri flag — distinguishes OCI / PIO / foreign nationals). */
    residencyStatus: text("residency_status", {
      enum: ["indian_resident", "nri", "oci", "pio", "foreign_national"],
    }),
    /** Last 4 digits of Aadhaar only — never store the full number. */
    aadhaarLast4: text("aadhaar_last4"),
    /** When CERSAI validation completed. */
    kycValidatedAt: date("kyc_validated_at"),
    /** User who last updated KYC fields — audit-friendly source. */
    kycLastUpdatedBy: uuid("kyc_last_updated_by").references(() => users.id),
    ckycNumber: text("ckyc_number"),
    ckycExpiryAt: date("ckyc_expiry_at"),
    kraName: text("kra_name"),
    fatcaStatus: text("fatca_status", { enum: ["pending", "verified", "expired"] }),
    fatcaExpiryAt: date("fatca_expiry_at"),

    /** AMFI DDQ fields (migration 0195) — asked explicitly in the questionnaire.
     *  2.1c: how this relationship is categorised. "incidental_advice" is the
     *  MFD carve-out — advice incidental to distribution, no advisory fee. */
    relationshipCategory: text("relationship_category", {
      enum: ["execution_only", "incidental_advice", "advisory"],
    }),
    /** 4.11c — Ultimate Beneficial Owner details (non-individual clients). */
    uboStatus: text("ubo_status", { enum: ["pending", "collected", "not_applicable"] }),
    uboCollectedAt: date("ubo_collected_at"),
    /** 4.13 — In-Person Verification, part of KYC diligence. */
    ipvStatus: text("ipv_status", { enum: ["pending", "done", "not_applicable"] }),
    ipvDate: date("ipv_date"),
    ipvByUserId: uuid("ipv_by_user_id"),

    /** Nominees — legacy single fields mirror nominees[0] for back-compat. */
    nomineeName: text("nominee_name"),
    nomineeRelation: text("nominee_relation"),
    nomineeDob: date("nominee_dob"),
    /** Multiple nominees. The legacy nominee_* columns mirror the first entry.
     *  Each nominee may carry a PAN document (panDocKey) which the create/update
     *  API registers as a client document. */
    nominees: jsonb("nominees")
      .$type<
        {
          name: string;
          relation?: string;
          dob?: string;
          mobile?: string;
          pan?: string;
          sharePct?: number;
          panDocKey?: string;
          panDocName?: string;
          panDocMime?: string;
          panDocSize?: number;
        }[]
      >()
      .default([]),

    /** Referrals — people this client referred (prospective leads / referral
     *  sources). Each carries name + optional relation/mobile/email/note. */
    referrals: jsonb("referrals")
      .$type<
        {
          name: string;
          relation?: string;
          mobile?: string;
          email?: string;
          note?: string;
        }[]
      >()
      .default([]),

    /** Bank (mandate) — legacy single fields mirror bankAccounts[0]. */
    bankName: text("bank_name"),
    bankAccountNumberMasked: text("bank_account_masked"),
    bankIfsc: text("bank_ifsc"),
    /** Multiple bank accounts. The legacy bank_* columns mirror the first entry. */
    bankAccounts: jsonb("bank_accounts")
      .$type<{ bankName: string; accountMasked?: string; ifsc?: string; accountType?: string }[]>()
      .default([]),

    /** Risk profile */
    riskProfileScore: integer("risk_profile_score"),
    riskProfile: text("risk_profile", {
      enum: ["conservative", "moderate", "aggressive", "very_aggressive"],
    }),
    riskProfileSignedAt: timestamp("risk_profile_signed_at", { withTimezone: true }),
    riskProfileVersion: integer("risk_profile_version"),

    /** Computed/cached metrics — refreshed nightly */
    aum: numeric("aum", { precision: 18, scale: 2 }).default("0"),
    activeSipAmount: numeric("active_sip_amount", { precision: 18, scale: 2 }).default("0"),
    lifetimeInflow: numeric("lifetime_inflow", { precision: 18, scale: 2 }).default("0"),
    lifetimeOutflow: numeric("lifetime_outflow", { precision: 18, scale: 2 }).default("0"),

    /** Persisted client-health scorecard (src/lib/investors/health.ts) —
     *  written on create/update + refreshed nightly. Sortable/filterable so
     *  the worst-health clients surface across the whole book. */
    healthScore: integer("health_score").notNull().default(100),
    healthBand: text("health_band", { enum: ["green", "amber", "red"] }).notNull().default("green"),
    healthScoredAt: timestamp("health_scored_at", { withTimezone: true }),

    /** Client-service preferences */
    statementCadence: text("statement_cadence", { enum: ["off", "monthly", "quarterly"] })
      .notNull()
      .default("off"),
    lastStatementSentAt: timestamp("last_statement_sent_at", { withTimezone: true }),
    languagePref: text("language_pref").notNull().default("en"),
    aumMilestoneBand: integer("aum_milestone_band").notNull().default(0),

    /** Relationship */
    rmId: uuid("rm_id").references(() => users.id),
    /** RM who SERVICES this client day-to-day (migration 0209). Distinct from
     *  rmId, the relationship owner that reporting and scoping use. */
    serviceRmId: uuid("service_rm_id").references(() => users.id),
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
    lastTransactionAt: timestamp("last_transaction_at", { withTimezone: true }),
    lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
    lastReviewAt: timestamp("last_review_at", { withTimezone: true }),
    nextReviewAt: timestamp("next_review_at", { withTimezone: true }),
    /** Explicit review cadence for this client. When null, cadence is derived
     *  from serviceTier (A=quarterly, B=half-yearly, C=annual). Drives nextReviewAt. */
    reviewFrequency: text("review_frequency", { enum: ["monthly", "quarterly", "half_yearly", "annual"] }),
    /** Custom review cadence in DAYS (e.g. 50, 100). When set, overrides the
     *  reviewFrequency preset above. Drives nextReviewAt. */
    reviewFrequencyDays: integer("review_frequency_days"),

    /** Lifecycle */
    isMinor: boolean("is_minor").default(false),
    guardianInvestorId: uuid("guardian_investor_id"),

    /**
     * Client lifecycle status — per spec § 6 Module 4:
     *   Active · Dormant · Inactive · Redemption Risk · Closed
     * Legacy `exited` retained as alias for `closed` so existing rows keep working.
     */
    status: text("status", {
      enum: ["active", "dormant", "inactive", "redemption_risk", "closed", "exited"],
    })
      .notNull()
      .default("active"),
    dormantSince: timestamp("dormant_since", { withTimezone: true }),
    exitedAt: timestamp("exited_at", { withTimezone: true }),
    /** When `redemption_risk` was flagged (auto by workflow or manual). */
    redemptionRiskFlaggedAt: timestamp("redemption_risk_flagged_at", { withTimezone: true }),
    redemptionRiskReason: text("redemption_risk_reason"),

    /**
     * Duplicate-merge bookkeeping (Sanchay "Find Duplicate Records" parity).
     * When two records for the same person are merged, the loser keeps a
     * pointer to the survivor + the merge timestamp and is set status=inactive.
     */
    mergedIntoId: uuid("merged_into_id"),
    mergedAt: timestamp("merged_at", { withTimezone: true }),

    /**
     * Soft-delete (Trash bin). When a client is deleted it's stamped here
     * instead of being hard-deleted; the row is hidden from every list + the
     * detail page and shown only in the Trash bin, recoverable until the
     * retention window elapses (default 30 days) when daily-ops auto-purges it.
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),

    /**
     * Contact-verification stamps (Sanchay "Verified At" parity). Set when an
     * RM confirms the email / phone is correct — drives a verification-due
     * worklist + deliverability hygiene.
     */
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
    contactVerifiedBy: uuid("contact_verified_by"),

    tags: jsonb("tags").$type<string[]>().default([]),
    notes: text("notes"),

    /**
     * Cross-sell / product-holdings matrix (Sanchay "Cross Selling" parity).
     * Map of product key -> status, e.g. { mutual_funds: "held_with_us",
     * life_insurance: "held_elsewhere", health_insurance: "not_held" }.
     * "held_elsewhere" / "interested" / "not_held" are wallet-share
     * opportunities. See src/lib/investors/cross-sell.ts.
     */
    crossSell: jsonb("cross_sell").$type<Record<string, string>>(),

    /** Extended client-master fields (migration 0127). All optional. */
    maritalStatus: text("marital_status"),
    modeOfHolding: text("mode_of_holding"), // single | joint | anyone_or_survivor
    anniversaryDate: date("anniversary_date"),
    /** RA sales: carried over from the lead on conversion (migration 0236). */
    subscriptionCategory: text("subscription_category"),
    subscriptionFrequency: text("subscription_frequency"),
    subscriptionStartedAt: date("subscription_started_at"),
    subscriptionRenewalAt: date("subscription_renewal_at"),
    /** ARN number shown on an RA client. */
    arnNo: text("arn_no"),
    taxStatus: text("tax_status"),
    birthPlace: text("birth_place"),
    motherName: text("mother_name"),
    mobileRelation: text("mobile_relation"), // whose mobile (self / spouse / …)
    emailRelation: text("email_relation"),
    referralClientName: text("referral_client_name"),
    familyOwnerName: text("family_owner_name"),
    householdType: text("household_type"), // "Family or Individual"
    /** Second / joint holder details. */
    secondHolderFirstName: text("second_holder_first_name"),
    secondHolderLastName: text("second_holder_last_name"),
    secondHolderOccupation: text("second_holder_occupation"),
    secondHolderCompanyName: text("second_holder_company_name"),
    secondHolderBirthPlace: text("second_holder_birth_place"),
    secondHolderMotherName: text("second_holder_mother_name"),
    secondHolderMaritalStatus: text("second_holder_marital_status"),

    /** Raw KYC submission captured from the public onboarding link (/d/<token>).
     *  The mapped fields land in dedicated columns above; this preserves the
     *  full submission verbatim (incl. unmapped fields like guardian / overseas
     *  address / TIN / PEP / source-of-wealth). Migration 0130. */
    kycData: jsonb("kyc_data").$type<Record<string, string>>(),
    // MFD-defined custom fields (migration 0166) — keyed by custom_field_defs.key.
    customFields: jsonb("custom_fields").$type<Record<string, any>>(),

    /** When true, this client participates in PAN uniqueness (the partial unique
     *  index below). RTA-feed, manual create, and lead-convert leave it true so a
     *  PAN can't be duplicated there. The bulk Excel importer sets it FALSE so a
     *  migrated book may legitimately carry the same PAN on multiple rows (e.g.
     *  one person split across accounts). Migration 0137. */
    dedupPan: boolean("dedup_pan").notNull().default(true),

    ...timestamps,
  },
  (t) => ({
    // PARTIAL unique: only rows opting into dedup (dedup_pan = true) with a real
    // PAN are constrained. Excel-imported rows (dedup_pan = false) may repeat a
    // PAN freely. Index NAME is unchanged so the `investors_tenant_pan_unique`
    // error-catch in manual create / lead-convert keeps working.
    panUnique: uniqueIndex("investors_tenant_pan_unique")
      .on(t.tenantId, t.pan)
      .where(sql`dedup_pan AND pan IS NOT NULL`),
    rmIdx: index("investors_rm_idx").on(t.tenantId, t.rmId),
    serviceRmIdx: index("investors_service_rm_idx").on(t.tenantId, t.serviceRmId),
    segmentIdx: index("investors_segment_idx").on(t.tenantId, t.segmentTag),
    lastReviewIdx: index("investors_last_review_idx").on(t.tenantId, t.lastReviewAt),
    lastTransactionIdx: index("investors_last_tx_idx").on(t.tenantId, t.lastTransactionAt),
    healthIdx: index("investors_health_idx").on(t.tenantId, t.healthScore),
    familyIdx: index("investors_family_idx").on(t.tenantId, t.familyId),
    // Hot list sort/filter columns (migration 0057).
    aumIdx: index("investors_aum_idx").on(t.tenantId, t.aum),
    sipIdx: index("investors_sip_idx").on(t.tenantId, t.activeSipAmount),
    nextReviewIdx: index("investors_next_review_idx").on(t.tenantId, t.nextReviewAt),
    statusIdx: index("investors_status_idx").on(t.tenantId, t.status),
    kycIdx: index("investors_kyc_idx").on(t.tenantId, t.kycStatus),
    tierIdx: index("investors_tier_idx").on(t.tenantId, t.serviceTier),
    clientCategoryIdx: index("investors_client_category_idx").on(t.tenantId, t.clientCategory),
  })
);

export type Investor = typeof investors.$inferSelect;
export type NewInvestor = typeof investors.$inferInsert;
