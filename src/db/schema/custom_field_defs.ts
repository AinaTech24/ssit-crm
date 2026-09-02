import { boolean, integer, jsonb, pgTable, text, timestamp, uuid, uniqueIndex, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * MFD-defined custom field definitions (migration 0166). Each firm adds its own
 * extra fields on leads / clients; values live in the record's `custom_fields`
 * jsonb bag keyed by `key`.
 */
export const customFieldDefs = pgTable(
  "custom_field_defs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    entity: text("entity", { enum: ["lead", "investor"] }).notNull(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    // `type` is a plain text column (no DB CHECK) — new types are additive and
    // need no migration. `options` holds the choice list for select/radio/
    // multiselect, and the single currency code (e.g. ["INR"]) for currency.
    type: text("type", {
      enum: ["text", "textarea", "number", "currency", "date", "select", "radio", "multiselect", "checkbox", "email", "phone", "url"],
    }).notNull(),
    options: jsonb("options").$type<string[]>(),
    required: boolean("required").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uq: uniqueIndex("custom_field_defs_uq").on(t.tenantId, t.entity, t.key),
    entityIdx: index("custom_field_defs_entity_idx").on(t.tenantId, t.entity, t.sortOrder),
  })
);
