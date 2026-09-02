import { jsonb, pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * Firm-wide layout defaults (migration 0165). The owner saves a module's
 * page-section arrangement (related_lists) or table columns as the firm default;
 * a user's own localStorage choice still wins for them.
 */
export const tenantUiLayouts = pgTable(
  "tenant_ui_layouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    moduleKey: text("module_key").notNull(),
    kind: text("kind", { enum: ["related_lists", "columns"] }).notNull(),
    data: jsonb("data").notNull(),
    updatedBy: uuid("updated_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uq: uniqueIndex("tenant_ui_layouts_uq").on(t.tenantId, t.moduleKey, t.kind),
  })
);
