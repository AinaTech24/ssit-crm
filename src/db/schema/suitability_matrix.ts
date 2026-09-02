/**
 * MF Suitability Matrix — Network FP "3.2" parity.
 *
 * One row per (tenant × risk_profile × time_horizon) = 9 cells per
 * tenant. Each cell lists the coarse scheme categories the firm
 * recommends for clients matching that profile + optional allocation %
 * + an IC rationale.
 *
 * Used by:
 *   - the suitability matrix admin / report view
 *   - future proposal-generation flow (lift cell → seed initial
 *     allocation, then narrow to specific shortlisted schemes)
 */

import { index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

export const RISK_PROFILES = ["low", "moderate", "high"] as const;
export const TIME_HORIZONS = ["short", "medium", "long"] as const;

export const suitabilityMatrixEntries = pgTable(
  "suitability_matrix_entries",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    riskProfile: text("risk_profile", { enum: RISK_PROFILES }).notNull(),
    timeHorizon: text("time_horizon", { enum: TIME_HORIZONS }).notNull(),
    coarseCategories: jsonb("coarse_categories")
      .$type<string[]>()
      .default([]),
    allocationHints: jsonb("allocation_hints").$type<
      Record<string, number>
    >(),
    notes: text("notes"),
    updatedBy: uuid("updated_by").references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    cellUnique: uniqueIndex("suitability_matrix_unique").on(
      t.tenantId,
      t.riskProfile,
      t.timeHorizon
    ),
    tenantIdx: index("suitability_matrix_tenant_idx").on(t.tenantId),
  })
);

export type SuitabilityMatrixEntry =
  typeof suitabilityMatrixEntries.$inferSelect;
export type NewSuitabilityMatrixEntry =
  typeof suitabilityMatrixEntries.$inferInsert;
