/**
 * DDQ audit-checklist status — owner-managed status per AMFI audit item.
 *
 * The item catalogue (40 items) lives in code
 * (src/lib/compliance/amfi-ddq-checklist.ts); this table only stores the
 * tenant's status + note per item key. Drives the real DDQ readiness %.
 */

import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";
import { complianceDocuments } from "./compliance";

export const DDQ_CHECKLIST_STATUSES = [
  "in_place",
  "in_progress",
  "pending",
  "not_applicable",
] as const;

export const ddqChecklistStatus = pgTable(
  "ddq_checklist_status",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    /** Stable item key from the AMFI checklist catalogue. */
    itemKey: text("item_key").notNull(),
    status: text("status", { enum: DDQ_CHECKLIST_STATUSES }).notNull().default("pending"),
    note: text("note"),
    documentId: uuid("document_id").references(() => complianceDocuments.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    cellUnique: uniqueIndex("ddq_checklist_status_unique").on(t.tenantId, t.itemKey),
    tenantIdx: index("ddq_checklist_status_tenant_idx").on(t.tenantId),
    documentIdx: index("ddq_checklist_status_document_idx").on(t.tenantId, t.documentId),
  })
);

export type DdqChecklistStatus = typeof ddqChecklistStatus.$inferSelect;
export type NewDdqChecklistStatus = typeof ddqChecklistStatus.$inferInsert;
