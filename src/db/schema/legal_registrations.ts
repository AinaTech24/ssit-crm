/**
 * Legal Registrations — firm-level register of all statutory + regulatory
 * registrations / licenses / permits the MFD firm holds.
 *
 * Network FP "1.3 Legal Registrations" template parity, modelled as a
 * proper relational entity so we get:
 *   - Live expiry traffic-light view (no manual XLSX update)
 *   - Daily expiry events feeding renewal-reminder recipes
 *   - Audit trail on every change
 *   - Certificate documents linked (URL or compliance-vault key)
 *
 * Distinct from `tenants.arn / euin / gst` which are hard-coded slots
 * for the most common 3. This table is the full register — anything
 * from SEBI Investment Adviser to Shop Act to Trademark.
 *
 * What MFDs typically register here (seed examples shipped):
 *   - SEBI registrations: ARN (via AMFI), RIA, PMS, REA, IA
 *   - IRDA: insurance distributor / broker license
 *   - GST: GSTIN, professional tax, TAN
 *   - MCA / ROC: CIN, LLPIN, Director DIN
 *   - Local: Shop & Establishment, MSME / Udyam
 *   - Trademark, Copyright, Patent
 *   - FATCA / CRS, FIU-IND
 */

import {
  date,
  index,
  jsonb,
  pgTable,
  text,
} from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * Canonical authority list — we use this on the form as a dropdown but
 * also accept a free-text override via `authorityOther` to cover the
 * long tail.
 */
export const REGULATORY_AUTHORITIES = [
  "AMFI",
  "SEBI",
  "IRDAI",
  "GST",
  "Income_Tax",
  "MCA",
  "RBI",
  "State_Govt",
  "Local_Authority",
  "Trademark_Registry",
  "FIU_IND",
  "Other",
] as const;

/**
 * Renewal cadence — most renewable registrations fit one of these. Free-text
 * overrides are captured in `renewalDetails`.
 */
export const RENEWAL_FREQUENCIES = [
  "perpetual",
  "annual",
  "biennial",
  "triennial",
  "5_year",
  "10_year",
  "on_demand",
  "other",
] as const;

export const LEGAL_REGISTRATION_STATUSES = [
  "active",
  "expired",
  "pending_renewal",
  "surrendered",
  "rejected",
] as const;

export const legalRegistrations = pgTable(
  "legal_registrations",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),

    /**
     * Whom the registration is in the name of. Usually the firm
     * (tenant.displayName). For sole proprietors / sub-distributors it
     * could be an individual — we don't constrain to FK because the
     * name might not match any user row exactly.
     */
    registeredInNameOf: text("registered_in_name_of").notNull(),

    /** Government / regulatory authority issuing the license. */
    authority: text("authority", { enum: REGULATORY_AUTHORITIES })
      .notNull()
      .default("Other"),
    /** Free-text label when authority='Other' (e.g. "FSSAI", "SEZ-Authority"). */
    authorityOther: text("authority_other"),

    /**
     * What the registration covers, in plain English. The MFD writes
     * this — examples: "Mutual fund distribution", "Investment advisory",
     * "Insurance broking", "GST under composition scheme".
     */
    registrationFor: text("registration_for").notNull(),

    /** License / registration number. */
    registrationNumber: text("registration_number"),

    registrationDate: date("registration_date"),
    /** Nullable — perpetual registrations don't expire. */
    expiryAt: date("expiry_at"),

    renewalFrequency: text("renewal_frequency", { enum: RENEWAL_FREQUENCIES })
      .notNull()
      .default("annual"),
    renewalDetails: text("renewal_details"),

    status: text("status", { enum: LEGAL_REGISTRATION_STATUSES })
      .notNull()
      .default("active"),

    /**
     * Certificate / supporting documents. Each entry is either a public
     * URL or a compliance-vault key (resolves via the existing
     * compliance.upload-url presign flow).
     *   { label, url, uploadedAt, uploadedBy }
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

    /** Audit. */
    createdBy: text("created_by"),

    ...timestamps,
  },
  (t) => ({
    tenantStatusIdx: index("legal_reg_tenant_status_idx").on(
      t.tenantId,
      t.status
    ),
    authorityIdx: index("legal_reg_authority_idx").on(t.tenantId, t.authority),
    expiryIdx: index("legal_reg_expiry_idx").on(t.tenantId, t.expiryAt),
  })
);

export type LegalRegistration = typeof legalRegistrations.$inferSelect;
export type NewLegalRegistration = typeof legalRegistrations.$inferInsert;

// users is the natural FK target for createdBy — kept as text to avoid
// migration weight on string IDs in audit-only fields.
void users;
