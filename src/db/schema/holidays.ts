/**
 * Holiday master — per-tenant list of non-working days. The daily attendance
 * auto-seed marks every active employee "holiday" on these dates, and the leave
 * form can warn when a request overlaps one. One row per (tenant, date).
 */

import { boolean, date, index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";

export const holidays = pgTable(
  "holidays",
  {
    id,
    tenantId,
    holidayDate: date("holiday_date").notNull(),
    name: text("name").notNull(),
    /** Optional/restricted holiday (informational — still auto-marked). */
    isOptional: boolean("is_optional").notNull().default(false),
    ...timestamps,
  },
  (t) => ({
    unique: uniqueIndex("holidays_tenant_date_uq").on(t.tenantId, t.holidayDate),
    dateIdx: index("holidays_date_idx").on(t.tenantId, t.holidayDate),
  })
);

export type Holiday = typeof holidays.$inferSelect;
