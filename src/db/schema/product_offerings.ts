/**
 * Product / Service offerings — the firm's catalog of what it actually
 * sells to clients.
 *
 * Network FP "1.5 Products / Services Offered" template parity. The
 * canonical source of truth for:
 *   - SEBI / DDQ "what products do you distribute?" questions
 *   - Lead intake — "what can this firm offer me?"
 *   - Internal compliance gating — when an RM tries to log a
 *     transaction in a category not in this list, raise a flag
 *
 * Distinct from:
 *   - amc_master (the global AMC catalog)
 *   - legal_registrations (the underlying licenses — this table FKs
 *     each offering to the registration that authorises it)
 *   - schemes / mf_master (specific funds within mutual_funds)
 */

import {
  date,
  index,
  jsonb,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";

/**
 * Coarse category covering everything an Indian MFD typically offers.
 * Drives filtering on the list page + the regulator hint on the form.
 */
export const PRODUCT_OFFERING_CATEGORIES = [
  "mutual_funds",
  "insurance_life",
  "insurance_general",
  "insurance_health",
  "pms",
  "aif",
  "bonds",
  "corporate_fd",
  "nps",
  "equity",
  "tax_planning",
  "estate_planning",
  "advisory",
  "loans",
  "real_estate",
  "international",
  "other",
] as const;

export const PRODUCT_OFFERING_STATUSES = [
  "active",
  "paused",
  "discontinued",
] as const;

export const productOfferings = pgTable(
  "product_offerings",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),

    /** Display name — e.g. "Mutual Fund Distribution", "Term Insurance". */
    name: text("name").notNull(),

    category: text("category", { enum: PRODUCT_OFFERING_CATEGORIES })
      .notNull()
      .default("other"),

    /**
     * Manufacturer / service-provider list — strings, not FKs. AMCs are
     * already in amc_master but insurance companies + bond issuers + tax
     * software providers aren't, so a free-form jsonb array is the only
     * scalable choice. Example: ["HDFC AMC", "ICICI Pru", "Nippon"].
     */
    providers: jsonb("providers").$type<string[]>().default([]),

    /**
     * Regulator that oversees this offering. Same enum as
     * legal_registrations.authority so the picker is consistent.
     */
    regulator: text("regulator").notNull().default("Other"),

    /**
     * Legal registration IDs that authorise the firm to distribute /
     * sell this product. Multi-value because some products need
     * stacked registrations (e.g. RIA + IRDAI for insurance-bundled
     * advisory).
     */
    linkedRegistrationIds: uuid("linked_registration_ids").array().default([]),

    /**
     * Exams / certifications team members need to handle this product.
     * Free text array because some are niche (e.g. "NISM-XII", "IRDA
     * Specified Persons", "CFA Level 2 — bonds desk only"). Strings,
     * not enums, so the long tail doesn't break.
     */
    requiredExams: jsonb("required_exams").$type<string[]>().default([]),

    /**
     * Team members trained on / responsible for this offering. uuid[]
     * referencing users.id — we don't FK at DB level to keep the array
     * flexible (Postgres FK on array elements is awkward; the API
     * validates IDs against the users catalog).
     */
    teamMemberIds: uuid("team_member_ids").array().default([]),

    status: text("status", { enum: PRODUCT_OFFERING_STATUSES })
      .notNull()
      .default("active"),

    launchedAt: date("launched_at"),
    discontinuedAt: date("discontinued_at"),

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
    nameIdx: index("product_offerings_tenant_name_idx").on(
      t.tenantId,
      t.name
    ),
    categoryIdx: index("product_offerings_tenant_category_idx").on(
      t.tenantId,
      t.category,
      t.status
    ),
    statusIdx: index("product_offerings_tenant_status_idx").on(
      t.tenantId,
      t.status
    ),
  })
);

export type ProductOffering = typeof productOfferings.$inferSelect;
export type NewProductOffering = typeof productOfferings.$inferInsert;
