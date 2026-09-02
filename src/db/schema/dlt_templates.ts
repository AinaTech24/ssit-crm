import { boolean, index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";

/**
 * TRAI DLT Pre-registered templates for SMS dispatches in India.
 */
export const dltTemplates = pgTable(
  "dlt_templates",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    
    /** TRAI DLT Template ID (assigned by the portal) */
    dltTemplateId: text("dlt_template_id").notNull(),
    
    /** Sender ID / Header (e.g. SSITTC, WEALTH) */
    senderId: text("sender_id").notNull(),
    
    /** Principal Entity ID (PE ID) */
    peId: text("pe_id").notNull(),
    
    /** Type of SMS: transactional, service (inferred), promotional */
    templateType: text("template_type", {
      enum: ["transactional", "service", "promotional"],
    }).notNull().default("service"),
    
    /** The approved DLT template body.
     *  Placeholders are typically written as {#var#}, {#val#}, or {#var}. */
    content: text("content").notNull(),
    
    isActive: boolean("is_active").notNull().default(true),
    
    ...timestamps,
  },
  (t) => ({
    dltIdUnique: uniqueIndex("dlt_templates_id_unique").on(t.tenantId, t.dltTemplateId),
    tenantIdIdx: index("dlt_templates_tenant_idx").on(t.tenantId),
  })
);

export type DltTemplate = typeof dltTemplates.$inferSelect;
export type NewDltTemplate = typeof dltTemplates.$inferInsert;
