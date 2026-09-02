import { date, index, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { branches } from "./branches";
import { investors } from "./investors";
import { insurancePolicies } from "./insurance";
import { users } from "./users";

/**
 * Insurance Claim tracker — follows a claim against a policy through its
 * lifecycle (intimated → file received → under process → settled / rejected).
 * A policy can have several claims over time; each is one row here.
 *
 * Links to the existing insurance_policies (the policy claimed against) + the
 * investor (claimant). Denormalised policyNumber / insurer / proposerName are
 * captured for fast list rendering and so a claim survives a policy edit.
 */
export const CLAIM_STATUSES = [
  "empty",
  "claim_intimated",
  "file_awaited",
  "file_received",
  "add_info_awaited",
  "query",
  "query_replied",
  "under_process",
  "settled_fully",
  "settled_partially",
  "rejected",
  "withdrawn",
] as const;

export const CLAIM_TYPES = ["main_claim", "supplementary", "pre_authorization", "rider", "other"] as const;
export const INTIMATION_MODES = ["phone", "email", "portal", "branch", "agent", "letter", "other"] as const;
export const SUBMITTED_MODES = ["online", "physical", "courier", "email", "agent", "other"] as const;
export const CLAIM_MODES = ["cashless", "reimbursement", "grievance"] as const;

export const insuranceClaims = pgTable(
  "insurance_claims",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    branchId: uuid("branch_id").references(() => branches.id),

    /** The policy this claim is against (+ denormalised fields). */
    policyId: uuid("policy_id").references(() => insurancePolicies.id),
    policyNumber: text("policy_number"),
    insurer: text("insurer"),

    /** Claimant. */
    investorId: uuid("investor_id").references(() => investors.id),
    proposerName: text("proposer_name").notNull(),
    contactPerson: text("contact_person"),
    email: text("email"),
    phone: text("phone"),

    claimStatus: text("claim_status", { enum: CLAIM_STATUSES }).notNull().default("claim_intimated"),
    policyDetails: text("policy_details"),

    /** Claim details. */
    claimType: text("claim_type", { enum: CLAIM_TYPES }),
    claimMode: text("claim_mode", { enum: CLAIM_MODES }),
    intimationMode: text("intimation_mode", { enum: INTIMATION_MODES }),
    submittedMode: text("submitted_mode", { enum: SUBMITTED_MODES }),

    admissionDate: date("admission_date"),
    intimationDate: date("intimation_date"),
    submissionDate: date("submission_date"),
    settlementDate: date("settlement_date"),

    claimedAmount: numeric("claimed_amount", { precision: 16, scale: 2 }).default("0"),
    settledAmount: numeric("settled_amount", { precision: 16, scale: 2 }).default("0"),

    /** Owning RM. */
    rmId: uuid("rm_id").references(() => users.id),
    comments: text("comments"),

    /** Claim document checklist — uploaded supporting files (bills, discharge
     *  summary, death certificate, KYC, bank proof…). `docType` keys the file to
     *  a checklist item; `key` is the storage key, `url` an external link. */
    documents: jsonb("documents")
      .$type<{ name: string; docType?: string; key?: string; url?: string; mime?: string; size?: number; uploadedAt?: string }[]>()
      .default([]),

    ...timestamps,
  },
  (t) => ({
    tenantIdx: index("claims_tenant_idx").on(t.tenantId, t.updatedAt),
    statusIdx: index("claims_status_idx").on(t.tenantId, t.claimStatus),
    investorIdx: index("claims_investor_idx").on(t.tenantId, t.investorId),
    policyIdx: index("claims_policy_idx").on(t.tenantId, t.policyId),
  })
);

export type InsuranceClaim = typeof insuranceClaims.$inferSelect;
export type NewInsuranceClaim = typeof insuranceClaims.$inferInsert;
