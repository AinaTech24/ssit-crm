import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * A placed widget on a custom dashboard. Layout is an ordered array of these —
 * order = render order; colSpan/rowSpan = size on a 4-column responsive grid.
 */
export interface DashboardWidgetInstance {
  /** Instance id (uuid) — distinct from the catalog widgetKey. */
  id: string;
  /** Catalog key (src/lib/dashboards/catalog.ts). */
  widgetKey: string;
  /** 1–4 columns wide. */
  colSpan: number;
  /** 1–3 rows tall. */
  rowSpan: number;
  /** Optional per-widget title override. */
  title?: string;
  /** Per-widget filter overrides (period / rm) — beat the board-level filter. */
  config?: { period?: string; rm?: string; [k: string]: unknown };
}

/**
 * Customizable dashboards — "My Dashboards". Each user can build several named
 * boards from the widget catalog, arrange them, set one as default home, and
 * (owner) share a board to the whole firm. Soft-deleted boards live in
 * "Recently Deleted" for 30 days. The role-based cockpit remains the built-in
 * default when a user has no custom default board.
 */
export const dashboards = pgTable(
  "dashboards",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    /** Creator / owner. A shared board is still owned by its creator. */
    userId: uuid("user_id").references(() => users.id),
    name: text("name").notNull(),
    description: text("description"),
    /** private = only the creator; shared = visible to the whole firm. */
    scope: text("scope", { enum: ["private", "shared"] }).notNull().default("private"),
    /** The user's default home board (one per user). */
    isDefault: boolean("is_default").notNull().default(false),
    /** Locked shared boards can be edited only by the creator / owner. */
    locked: boolean("locked").notNull().default(false),
    layout: jsonb("layout").$type<DashboardWidgetInstance[]>().notNull().default([]),
    /** Board-level default filters applied to every widget. */
    filters: jsonb("filters").$type<{ period?: string; rm?: string }>(),
    /** Soft delete → Recently Deleted (restorable 30 days). */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    tenantUserIdx: index("dashboards_tenant_user_idx").on(t.tenantId, t.userId),
    sharedIdx: index("dashboards_shared_idx").on(t.tenantId, t.scope),
    // At most one default board per user among the live (non-deleted) boards.
    defaultUnique: uniqueIndex("dashboards_default_unique")
      .on(t.tenantId, t.userId)
      .where(sql`is_default = true AND deleted_at IS NULL`),
  })
);

export type Dashboard = typeof dashboards.$inferSelect;
