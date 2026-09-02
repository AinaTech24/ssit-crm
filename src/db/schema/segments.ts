import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenantId, timestamps, id } from "./_shared";
import { tenants } from "./tenants";

export const segments = pgTable(
  "segments",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    name: text("name").notNull(),
    description: text("description"),
    kind: text("kind", { enum: ["static", "dynamic"] }).notNull(),
    subjectType: text("subject_type", { enum: ["investor", "lead", "task"] }).notNull(),

    /** FilterAST — see lib/filter/ast.ts. Null only for empty static segments. */
    ast: jsonb("ast"),

    /** Materialization schedule for dynamic segments. Cron string. */
    refreshCron: text("refresh_cron").default("0 * * * *"),

    memberCount: integer("member_count").default(0),
    lastMaterializedAt: timestamp("last_materialized_at", { withTimezone: true }),
    lastMaterializationMs: integer("last_materialization_ms"),
    materializerEnabled: boolean("materializer_enabled").default(true),

    /** Saved view metadata — columns to show, sort order — when used as a saved view */
    viewConfig: jsonb("view_config"),

    ...timestamps,
  },
  (t) => ({
    nameUnique: uniqueIndex("segments_tenant_name_unique").on(t.tenantId, t.name),
    refreshIdx: index("segments_refresh_idx").on(t.tenantId, t.kind),
  })
);

export const segmentMemberships = pgTable(
  "segment_memberships",
  {
    segmentId: uuid("segment_id")
      .notNull()
      .references(() => segments.id, { onDelete: "cascade" }),
    tenantId: tenantId.references(() => tenants.id),
    subjectId: uuid("subject_id").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.segmentId, t.subjectId] }),
    activeIdx: index("seg_members_active_idx")
      .on(t.tenantId, t.subjectId)
      .where(sql`removed_at IS NULL`),
  })
);

export type Segment = typeof segments.$inferSelect;
export type SegmentMembership = typeof segmentMemberships.$inferSelect;
