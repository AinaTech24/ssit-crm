/**
 * Leave applications — team HR (Sanchay-parity).
 *
 * Employee leave requests with an approval workflow. Applicant + approver are
 * `users` (employees). Entitlements/balances are policy-driven (see
 * src/lib/leave/policy.ts) + computed from approved rows — no separate balance
 * table for v1.
 */

import { date, index, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";

export const LEAVE_TYPES = ["casual", "sick", "earned", "unpaid", "comp_off", "other"] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const LEAVE_DURATIONS = ["full_day", "half_day"] as const;
export type LeaveDuration = (typeof LEAVE_DURATIONS)[number];

export const LEAVE_STATUSES = ["requested", "approved", "rejected", "cancelled"] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const leaveApplications = pgTable(
  "leave_applications",
  {
    id,
    tenantId,
    /** The employee the leave is for (applicant). */
    employeeUserId: uuid("employee_user_id").notNull(),
    leaveType: text("leave_type", { enum: LEAVE_TYPES }).notNull(),
    duration: text("duration", { enum: LEAVE_DURATIONS }).notNull().default("full_day"),
    fromDate: date("from_date").notNull(),
    toDate: date("to_date").notNull(),
    /** Computed working-day count (0.5 for a half-day). */
    noOfDays: numeric("no_of_days", { precision: 5, scale: 1 }).notNull().default("1"),
    reason: text("reason"),
    comments: text("comments"),
    status: text("status", { enum: LEAVE_STATUSES }).notNull().default("requested"),
    /** Manager who approved/rejected. */
    approverUserId: uuid("approver_user_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNotes: text("decision_notes"),
    ...timestamps,
  },
  (t) => ({
    statusIdx: index("leave_app_status_idx").on(t.tenantId, t.status, t.fromDate),
    employeeIdx: index("leave_app_employee_idx").on(t.tenantId, t.employeeUserId, t.fromDate),
    rangeIdx: index("leave_app_range_idx").on(t.tenantId, t.fromDate, t.toDate),
  })
);

export type LeaveApplication = typeof leaveApplications.$inferSelect;
export type NewLeaveApplication = typeof leaveApplications.$inferInsert;
