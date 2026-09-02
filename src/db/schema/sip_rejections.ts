/**
 * SIP Rejection records — spec § Module 11.
 *
 * A `transactions` row with `type='sip' AND status='rejected'` is the raw
 * event. This table holds the recovery workflow on top of it: who's
 * responsible, what state the follow-up is in, what's been tried.
 *
 * Records are auto-created via the `sips:rejected` outbox handler whenever
 * a rejection lands. Manual creation is also supported via the create form.
 */

import {
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { id, tenantId, timestamps } from "./_shared";

export const SIP_RECOVERY_STATUSES = [
  "pending",
  "client_contacted",
  "bank_issue",
  "mandate_issue",
  "reprocessed",
  "recovered",
  "not_recoverable",
] as const;

export type SipRecoveryStatus = (typeof SIP_RECOVERY_STATUSES)[number];

/** Recovery statuses that still need action — used by the SLA escalation,
 *  the "open" saved view, the aging buckets and the per-RM accountability cut. */
export const SIP_OPEN_STATUSES = [
  "pending",
  "client_contacted",
  "bank_issue",
  "mandate_issue",
] as const;

/** Coarse reason bucket — the same slugs the sip_rejection_followup recipe
 *  branches on. Stored on the row so the pipeline can show a reason-mix and
 *  filter by category. */
export const SIP_REASON_CATEGORIES = [
  "insufficient_balance",
  "mandate_expired",
  "technical",
] as const;

export type SipReasonCategory = (typeof SIP_REASON_CATEGORIES)[number];

export const sipRejections = pgTable(
  "sip_rejections",
  {
    id,
    tenantId,
    investorId: uuid("investor_id").notNull(),
    /** Originating rejected transaction (1:1). NULL if entered manually. */
    transactionId: uuid("transaction_id"),
    /** Owning SIP (so we can show details + relink to mandate). */
    sipId: uuid("sip_id"),

    /** Spec § Module 11 — cached for display. */
    rejectionDate: date("rejection_date").notNull(),
    rejectionAmount: numeric("rejection_amount", { precision: 18, scale: 2 }).notNull(),
    rejectionReason: text("rejection_reason"),
    schemeName: text("scheme_name"),
    folioNumber: text("folio_number"),
    amcName: text("amc_name"),

    /** Recovery workflow. */
    assignedRmId: uuid("assigned_rm_id"),
    followUpDate: date("follow_up_date"),
    recoveryDate: date("recovery_date"),
    recoveryStatus: text("recovery_status", { enum: SIP_RECOVERY_STATUSES })
      .notNull()
      .default("pending"),
    /** Set when status last changed — used by the 2-day escalation. */
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Free-text remarks — latest at top in the UI. */
    remarks: text("remarks"),

    /** Coarse reason bucket (insufficient_balance / mandate_expired / technical)
     *  classified on ingest. Drives the reason-mix breakdown + category filter. */
    reasonCategory: text("reason_category", { enum: SIP_REASON_CATEGORIES }),

    /** When the 2-day-SLA escalation last fired — so we notify once, not daily. */
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),

    /** Import idempotency key — hash of the rejection's natural key. Makes the
     *  RTA rejection-report path a no-op on re-upload. */
    dedupKey: text("dedup_key"),

    ...timestamps,
  },
  (t) => ({
    investorIdx: index("sip_rej_investor_idx").on(t.tenantId, t.investorId, t.rejectionDate),
    statusIdx: index("sip_rej_status_idx").on(t.tenantId, t.recoveryStatus, t.statusChangedAt),
    rmIdx: index("sip_rej_rm_idx").on(t.tenantId, t.assignedRmId, t.recoveryStatus),
    reasonCatIdx: index("sip_rej_reason_cat_idx").on(t.tenantId, t.reasonCategory),
    transactionUnique: uniqueIndex("sip_rej_tx_unique")
      .on(t.tenantId, t.transactionId)
      .where(sql`transaction_id IS NOT NULL`),
    dedupUnique: uniqueIndex("sip_rej_dedup_unique").on(t.tenantId, t.dedupKey),
  })
);

export type SipRejection = typeof sipRejections.$inferSelect;
export type NewSipRejection = typeof sipRejections.$inferInsert;
