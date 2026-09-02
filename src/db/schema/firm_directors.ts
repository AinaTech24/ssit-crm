/**
 * Firm directors / founders / partners — the people who own or
 * legally represent the firm.
 *
 * Distinct from `users` (operational staff with login accounts):
 * directors may not log into the CRM at all — they're regulator-facing
 * data shown on the firm profile, in DDQs, and on incorporation docs.
 *
 * Multi-entry (a Pvt Ltd has 2-15 directors); kept as its own table
 * instead of a jsonb on tenants so we can:
 *   - audit individual additions / resignations
 *   - track DIN expiry (some directors fall foul of MCA filing rules)
 *   - link documents per director (KYC, board resolution, etc.)
 */

import {
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
} from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";

export const DIRECTOR_ROLES = [
  "founder",
  "director",
  "partner",
  "designated_partner",
  "managing_director",
  "whole_time_director",
  "independent_director",
  "authorized_signatory",
  "proprietor",
  "karta", // HUF
  "other",
] as const;

export const DIRECTOR_STATUSES = ["active", "resigned"] as const;

export const firmDirectors = pgTable(
  "firm_directors",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),

    name: text("name").notNull(),
    role: text("role", { enum: DIRECTOR_ROLES }).notNull().default("director"),
    designation: text("designation"),

    /** Director Identification Number — MCA-issued, 8-digit. */
    din: text("din"),
    /** Personal PAN. */
    panNumber: text("pan_number"),

    email: text("email"),
    phone: text("phone"),

    /** Equity share — 25.50 = 25.5%. Null for non-shareholder directors. */
    shareholdingPct: numeric("shareholding_pct", { precision: 5, scale: 2 }),

    dateOfAppointment: date("date_of_appointment"),
    dateOfResignation: date("date_of_resignation"),

    status: text("status", { enum: DIRECTOR_STATUSES })
      .notNull()
      .default("active"),

    /**
     * Documents — KYC, board resolution appointing them, DSC cert, etc.
     *   [{ label, url, uploadedAt }]
     */
    documents: jsonb("documents")
      .$type<
        Array<{
          label: string;
          url: string;
          uploadedAt?: string;
        }>
      >()
      .default([]),

    remarks: text("remarks"),

    createdBy: text("created_by"),

    ...timestamps,
  },
  (t) => ({
    statusIdx: index("firm_directors_tenant_status_idx").on(
      t.tenantId,
      t.status
    ),
    roleIdx: index("firm_directors_tenant_role_idx").on(t.tenantId, t.role),
  })
);

export type FirmDirector = typeof firmDirectors.$inferSelect;
export type NewFirmDirector = typeof firmDirectors.$inferInsert;
