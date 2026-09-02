import { date, index, jsonb, numeric, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { branches } from "./branches";
import { investors } from "./investors";
import { insurancePolicies } from "./insurance";
import { users } from "./users";

/**
 * Manual insurance commission ledger — actual commission the firm RECEIVED, as
 * opposed to the per-policy `commission_paisa` estimate captured at policy entry.
 * Lets the team log payouts from insurers (first-year, trail/renewal, override,
 * bonus) with TDS + net, optionally linked to a policy/client, for reconciliation
 * against the estimated book.
 */
export const COMMISSION_TYPES = ["first_year", "trail_renewal", "override", "bonus", "reward", "other"] as const;
export type CommissionType = (typeof COMMISSION_TYPES)[number];

export const insuranceCommissionEntries = pgTable(
  "insurance_commission_entries",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    branchId: uuid("branch_id").references(() => branches.id),

    /** When the commission was received / booked. */
    entryDate: date("entry_date").notNull(),
    insurer: text("insurer"),
    /** Optional link to a specific policy / client. */
    policyId: uuid("policy_id").references(() => insurancePolicies.id),
    policyNumber: text("policy_number"),
    investorId: uuid("investor_id").references(() => investors.id),

    commissionType: text("commission_type", { enum: COMMISSION_TYPES }).notNull().default("first_year"),
    grossAmount: numeric("gross_amount", { precision: 16, scale: 2 }).notNull().default("0"),
    tdsAmount: numeric("tds_amount", { precision: 16, scale: 2 }).notNull().default("0"),
    netAmount: numeric("net_amount", { precision: 16, scale: 2 }).notNull().default("0"),

    /** Human period label, e.g. "Jun 2026" / "FY25-26 Q1". */
    periodLabel: text("period_label"),
    /** Insurer payout statement / reference number. */
    referenceNo: text("reference_no"),
    notes: text("notes"),
    /** Arbitrary extra fields for future-proofing. */
    meta: jsonb("meta").$type<Record<string, any>>().default({}),

    recordedByUserId: uuid("recorded_by_user_id").references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    dateIdx: index("ins_comm_entry_date_idx").on(t.tenantId, t.entryDate),
    insurerIdx: index("ins_comm_entry_insurer_idx").on(t.tenantId, t.insurer),
    policyIdx: index("ins_comm_entry_policy_idx").on(t.tenantId, t.policyId),
  })
);

export type InsuranceCommissionEntry = typeof insuranceCommissionEntries.$inferSelect;
