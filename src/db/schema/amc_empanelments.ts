/**
 * AMC Empanelments — the firm's contractual + operational relationship
 * with each AMC.
 *
 * Distinct from `amc_master` (the global catalog of AMCs — code, name,
 * regulator data) and `amc_payouts` (the brokerage feed). This is the
 * per-tenant relationship row: which AMCs we're empanelled with, when,
 * who we call when something goes wrong, and what trail rate they
 * promised us in the agreement.
 *
 * Network FP "1.4 AMC Empanelments" template parity, modelled with:
 *   - Structured 3-tier contact tree (RM / Ops / Escalation) +
 *     extensible additionalContacts jsonb for marketing / product / etc.
 *   - distributor_code (the AMC issues each MFD a code; needed on
 *     transactions + commission file matching)
 *   - trail_rate_override_pct so the brokerage reconciler can use the
 *     real empanelment number instead of the conservative fallback
 *   - status workflow with anniversary tracking
 *   - documents jsonb for empanelment letter / MOU / addendums
 *
 * Why not extend amc_master: that's a global catalog row shared across
 * tenants. Empanelment is per-firm × per-AMC; needs its own table.
 */

import {
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

/**
 * Product line an empanelment covers. A firm empanels separately per product —
 * the MF agreement, the PMS/AIF agreement and the insurance tie-up are
 * different contracts with different codes and renewal dates.
 */
export const EMPANELMENT_CATEGORIES = [
  { value: "mf", label: "MF" },
  { value: "pms_aif", label: "PMS / AIF" },
  { value: "insurance", label: "Insurance" },
  { value: "las", label: "Loan Against Share" },
  { value: "unlisted_share", label: "Unlisted Share" },
] as const;

export const EMPANELMENT_CATEGORY_VALUES = EMPANELMENT_CATEGORIES.map((c) => c.value);

export const EMPANELMENT_CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  EMPANELMENT_CATEGORIES.map((c) => [c.value, c.label])
);

export const EMPANELMENT_STATUSES = [
  "empanelled",
  "under_review",
  "suspended",
  "terminated",
] as const;

export const amcEmpanelments = pgTable(
  "amc_empanelments",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),

    /**
     * AMC code — references amc_master.code. We don't enforce the FK to
     * keep new-tenant migration simple (amc_master is seeded async); the
     * UI's AMC picker constrains to valid codes.
     */
    /** Product line this empanelment covers (migration 0207). NULL = not yet set. */
    category: text("category"),
    amcCode: text("amc_code").notNull(),
    /** Display name cached for fast list rendering. */
    amcName: text("amc_name").notNull(),

    /**
     * The distributor code the AMC issues to this firm. Different per
     * AMC even though our ARN is the same. Critical for matching
     * commission payouts back to us.
     */
    distributorCode: text("distributor_code"),

    empanelmentDate: date("empanelment_date"),

    status: text("status", { enum: EMPANELMENT_STATUSES })
      .notNull()
      .default("empanelled"),
    terminatedAt: date("terminated_at"),

    // ── Primary contacts (the 3 in the Network FP template) ──────────
    rmName: text("rm_name"),
    rmEmail: text("rm_email"),
    rmPhone: text("rm_phone"),

    opsName: text("ops_name"),
    opsEmail: text("ops_email"),
    opsPhone: text("ops_phone"),

    escalationName: text("escalation_name"),
    escalationEmail: text("escalation_email"),
    escalationPhone: text("escalation_phone"),

    /**
     * Anything beyond the 3 primaries — Marketing / Product / Branch
     * Manager / CXO. Format:
     *   [{ role, name, email, phone, notes? }]
     */
    additionalContacts: jsonb("additional_contacts")
      .$type<
        Array<{
          role: string;
          name: string;
          email?: string;
          phone?: string;
          notes?: string;
        }>
      >()
      .default([]),

    /**
     * AMC's distributor login portal URL. One click from the detail
     * page when ops needs to log in.
     */
    portalUrl: text("portal_url"),

    /**
     * Trail rate override (% per annum) — the rate the AMC negotiated
     * in the empanelment agreement. If set, the brokerage reconciler
     * uses this instead of the FALLBACK_TRAIL by category.
     */
    trailRateOverridePct: numeric("trail_rate_override_pct", {
      precision: 6,
      scale: 4,
    }),

    /**
     * Empanelment letter / MOU / addendums.
     *   [{ label, url, uploadedAt, uploadedBy }]
     */
    documents: jsonb("documents")
      .$type<
        Array<{
          label: string;
          url: string;
          uploadedAt?: string;
          uploadedBy?: string;
        }>
      >()
      .default([]),

    remarks: text("remarks"),

    /**
     * Firm's investment-committee due-diligence notes — Network FP
     * "3.1 AMC Schemes" parity (migration 0026). RM-facing context for
     * why we do or don't lean into this AMC.
     */
    investmentPhilosophy: text("investment_philosophy"),
    fundHouseStrengths: text("fund_house_strengths"),
    redFlags: text("red_flags"),

    createdBy: text("created_by"),

    ...timestamps,
  },
  (t) => ({
    /** One empanelment per (tenant, AMC). */
    tenantAmcUnique: uniqueIndex("amc_empanelments_tenant_amc_unique").on(
      t.tenantId,
      t.amcCode
    ),
    statusIdx: index("amc_empanelments_tenant_status_idx").on(
      t.tenantId,
      t.status
    ),
    dateIdx: index("amc_empanelments_tenant_date_idx").on(
      t.tenantId,
      t.empanelmentDate
    ),
  })
);

export type AmcEmpanelment = typeof amcEmpanelments.$inferSelect;
export type NewAmcEmpanelment = typeof amcEmpanelments.$inferInsert;
