/**
 * Per-tenant attendance policy — work hours, grace, half/full-day thresholds,
 * and which weekdays are weekly-offs. One row per tenant (created lazily with
 * sensible India defaults). Drives late / early-out flags + the daily auto-seed.
 */

import { boolean, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";

export const attendanceSettings = pgTable(
  "attendance_settings",
  {
    id,
    tenantId,
    /** Expected clock-in / clock-out wall time, "HH:MM" (interpreted in IST). */
    workStart: text("work_start").notNull().default("10:00"),
    workEnd: text("work_end").notNull().default("18:30"),
    /** Minutes of slack before a late-in / early-out is flagged. */
    graceMinutes: integer("grace_minutes").notNull().default(10),
    /** Worked < this (but > 0) ⇒ treat as a short/half day. Minutes. */
    halfDayMinutes: integer("half_day_minutes").notNull().default(240),
    /** Worked ≥ this ⇒ a full present day. Minutes. */
    fullDayMinutes: integer("full_day_minutes").notNull().default(480),
    /** Weekly-off weekdays, 0=Sun … 6=Sat. Default Sunday. */
    weekOffDays: jsonb("week_off_days").$type<number[]>().notNull().default([0]),
    /** Require a clock-in geolocation (UI hint; not hard-enforced). */
    requireGeo: boolean("require_geo").notNull().default(false),
    ...timestamps,
  },
  (t) => ({
    unique: uniqueIndex("attendance_settings_tenant_uq").on(t.tenantId),
  })
);

export type AttendanceSettings = typeof attendanceSettings.$inferSelect;
