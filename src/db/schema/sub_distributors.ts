/**
 * Sub-distributors — external channel partners who source business
 * under the parent MFD's ARN. Distinct from `users` (which is W2 staff
 * + login accounts); sub-distributors typically don't log into the
 * parent's CRM, they're contact records the firm uses for compliance
 * tracking + commission attribution.
 *
 * SEBI compliance angle: the parent ARN holder is required to maintain
 * a register of every sub-ARN issued under their ARN. This table is
 * that register, with the same expiry-tracking discipline as the
 * employees table (NISM / ARN / EUIN).
 *
 * Commission angle: when brokerage records come in from CAMS / Karvy /
 * BSE Star MF, we attribute by ARN. Sub-distributor's personal ARN
 * appears on transactions they sourced, and the commission_split_pct
 * field drives the payout calc — e.g. parent keeps 30%, sub gets 70%
 * of the trail.
 *
 * Attribution: leads can carry a sub_distributor_id (see leads schema
 * extension) so the source RM can credit the right channel partner.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

export const SUB_DISTRIBUTOR_ASSOCIATIONS = [
  /** Individual person who sources clients */
  "individual",
  /** A firm / proprietorship that's a separate legal entity */
  "firm",
  /** Channel partner with formal ongoing contract */
  "channel_partner",
  /** Referral partner — no ongoing contract, just commission on conversion */
  "referral_partner",
  /** Family member / employee referring under their own EUIN */
  "internal_referral",
  "other",
] as const;

export const SUB_DISTRIBUTOR_STATUSES = [
  "active",
  "inactive",
  "terminated",
] as const;

export const subDistributors = pgTable(
  "sub_distributors",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),

    /** Display name — individual or firm name. */
    name: text("name").notNull(),

    /**
     * Internal code the parent assigns — e.g. "SD-001" or any HR
     * scheme. Unique within tenant when set; lets the firm reference
     * sub-distributors in reports + commission files.
     */
    code: text("code"),

    typeOfAssociation: text("type_of_association", {
      enum: SUB_DISTRIBUTOR_ASSOCIATIONS,
    }).notNull().default("individual"),

    /** City / location — primary geography of the sub-distributor. */
    city: text("city"),

    email: text("email"),
    mobile: text("mobile"),

    /** PAN — required for tax reporting on commission payouts. */
    panNumber: text("pan_number"),

    // ── Licensing (mirrors Network FP "ARN/EUIN Tracker" template) ───
    nismCertificateNo: text("nism_cert_no"),
    nismExamDate: date("nism_exam_date"),
    nismExpiryAt: date("nism_expiry_at"),
    nismCategory: text("nism_category"),

    /** Sub-distributor's personal ARN. */
    arnNumber: text("arn_number"),
    arnRegistrationDate: date("arn_registration_date"),
    arnExpiryAt: date("arn_expiry_at"),

    /** EUIN registered under the parent's ARN. */
    euin: text("euin"),
    euinExpiryAt: date("euin_expiry_at"),

    /**
     * Commission split — percentage of trail brokerage that goes to
     * the sub-distributor. 70.00 = 70%. Stored as numeric to avoid
     * floating-point rounding errors in payout files.
     */
    commissionSplitPct: numeric("commission_split_pct", {
      precision: 5,
      scale: 2,
    }),

    /**
     * Bank details for commission payouts. JSON because we don't query
     * inside the fields and SEBI doesn't mandate structure here.
     *   { accountHolder, accountNumber, ifsc, bankName, branch?, upi? }
     */
    bankDetails: jsonb("bank_details").$type<{
      accountHolder?: string;
      accountNumber?: string;
      ifsc?: string;
      bankName?: string;
      branch?: string;
      upi?: string;
    }>(),

    status: text("status", { enum: SUB_DISTRIBUTOR_STATUSES })
      .notNull()
      .default("active"),

    /** Date the agreement was signed. */
    onboardedAt: date("onboarded_at"),
    /** When the relationship ended (status='terminated'). */
    terminatedAt: date("terminated_at"),

    /** Free-text remarks — covers everything the structured fields don't. */
    remarks: text("remarks"),

    /** Whether they have DSC on file (for BSE Star MF execution under
     *  the parent's terminal). Most sub-distributors don't. */
    dscOnFile: boolean("dsc_on_file").default(false),

    /** RM at the parent firm who's the primary contact. */
    relationshipManagerId: text("relationship_manager_id"),

    /** Audit. */
    createdBy: text("created_by"),

    ...timestamps,
  },
  (t) => ({
    codeUnique: uniqueIndex("sub_distributors_tenant_code_unique")
      .on(t.tenantId, t.code)
      .where(sql`code IS NOT NULL`),
    nameIdx: index("sub_distributors_tenant_name_idx").on(t.tenantId, t.name),
    statusIdx: index("sub_distributors_tenant_status_idx").on(t.tenantId, t.status),
    arnIdx: index("sub_distributors_tenant_arn_idx").on(t.tenantId, t.arnNumber),
    rmIdx: index("sub_distributors_tenant_rm_idx").on(t.tenantId, t.relationshipManagerId),
  })
);

export type SubDistributor = typeof subDistributors.$inferSelect;
export type NewSubDistributor = typeof subDistributors.$inferInsert;

// Suppress unused-import warning — users is the natural FK target for
// relationshipManagerId but we kept it as text to avoid migration
// complexity on the existing user row IDs.
void users;
