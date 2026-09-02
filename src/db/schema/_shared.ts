import { timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Standard timestamps every table carries.
 */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

/**
 * Tenant scoping column — present on every domain table. RLS policies enforce
 * `tenant_id = current_setting('app.tenant_id')::uuid`.
 */
export const tenantId = uuid("tenant_id").notNull();

export const id = uuid("id").primaryKey().defaultRandom();
