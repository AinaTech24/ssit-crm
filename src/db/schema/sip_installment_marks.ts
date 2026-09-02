/**
 * Manual overrides for the New-SIP installment watch (SIP Tracker).
 *
 * The first-6-installments grid is auto-derived from the CAMS/KFintech feed
 * (transactions of type 'sip'). This table holds the RM's MANUAL marks for cells
 * the feed hasn't covered yet, or corrections — one row per (sip, installment_no)
 * overrides that cell's auto status. See @/lib/finance/sip-installment-watch.
 */

import { index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { sips } from "./transactions";
import { users } from "./users";

export const SIP_INSTALLMENT_MARK_STATUSES = ["deducted", "bounced", "pending"] as const;

export const sipInstallmentMarks = pgTable(
  "sip_installment_marks",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    sipId: uuid("sip_id")
      .notNull()
      .references(() => sips.id, { onDelete: "cascade" }),
    installmentNo: integer("installment_no").notNull(),
    status: text("status", { enum: SIP_INSTALLMENT_MARK_STATUSES }).notNull(),
    note: text("note"),
    markedById: uuid("marked_by_id").references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    uq: uniqueIndex("sip_installment_marks_uq").on(t.tenantId, t.sipId, t.installmentNo),
    sipIdx: index("sip_installment_marks_sip_idx").on(t.tenantId, t.sipId),
  })
);

export type SipInstallmentMark = typeof sipInstallmentMarks.$inferSelect;
