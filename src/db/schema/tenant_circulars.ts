import { date, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";

/**
 * A tenant's OWN saved regulatory circulars / compliance notes — distinct from
 * the platform-shared amfi_circulars (Equitywala-curated, read-only). Each MFD builds
 * their private compliance library, typically by saving AI-summarised drafts
 * from the circular summariser. Tenant-scoped with standard RLS.
 */
export const tenantCirculars = pgTable(
  "tenant_circulars",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    title: text("title").notNull(),
    issuer: text("issuer"),
    category: text("category"),
    summary: text("summary").notNull(),
    mfdAction: text("mfd_action"),
    severity: text("severity", { enum: ["info", "action_required", "critical"] }).notNull().default("info"),
    sourceUrl: text("source_url"),
    publishedOn: date("published_on"),
    tags: jsonb("tags").$type<string[]>(),
    createdBy: uuid("created_by"),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index("tenant_circulars_tenant_idx").on(t.tenantId, t.createdAt),
  })
);

export type TenantCircular = typeof tenantCirculars.$inferSelect;
export type NewTenantCircular = typeof tenantCirculars.$inferInsert;
