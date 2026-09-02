/**
 * Attendance regularization — an employee who missed a punch (or was wrongly
 * marked absent) requests a correction for a specific day; a manager approves
 * or rejects. On approval the target day's attendance row is updated. Mirrors
 * the leave request → decision workflow.
 */

import { date, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { ATTENDANCE_STATUSES } from "./attendance";

export const REGULARIZATION_STATUSES = ["requested", "approved", "rejected", "cancelled"] as const;
export type RegularizationStatus = (typeof REGULARIZATION_STATUSES)[number];

export const attendanceRegularizations = pgTable(
  "attendance_regularizations",
  {
    id,
    tenantId,
    employeeUserId: uuid("employee_user_id").notNull(),
    attendanceDate: date("attendance_date").notNull(),
    /** The corrected status the employee is asking for. */
    requestedStatus: text("requested_status", { enum: ATTENDANCE_STATUSES }).notNull().default("present"),
    /** Optional corrected clock times (employee forgot to punch). */
    requestedClockInAt: timestamp("requested_clock_in_at", { withTimezone: true }),
    requestedClockOutAt: timestamp("requested_clock_out_at", { withTimezone: true }),
    reason: text("reason"),
    status: text("status", { enum: REGULARIZATION_STATUSES }).notNull().default("requested"),
    reviewerUserId: uuid("reviewer_user_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNotes: text("decision_notes"),
    ...timestamps,
  },
  (t) => ({
    statusIdx: index("att_reg_status_idx").on(t.tenantId, t.status, t.attendanceDate),
    employeeIdx: index("att_reg_employee_idx").on(t.tenantId, t.employeeUserId, t.attendanceDate),
  })
);

export type AttendanceRegularization = typeof attendanceRegularizations.$inferSelect;
