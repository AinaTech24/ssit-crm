import { pgTable, text, uuid, index, uniqueIndex } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";

export const ignoredDuplicates = pgTable(
  "ignored_duplicates",
  {
    id,
    tenantId,
    entityType: text("entity_type").notNull(), // 'client' or 'family'
    key1: uuid("key1_id").notNull(),
    key2: uuid("key2_id").notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index("ignored_duplicates_tenant_idx").on(t.tenantId),
    pairIdx: index("ignored_duplicates_pair_idx").on(t.tenantId, t.key1, t.key2),
    pairUnique: uniqueIndex("ignored_duplicates_pair_unique").on(t.tenantId, t.key1, t.key2),
  })
);

export type IgnoredDuplicate = typeof ignoredDuplicates.$inferSelect;
export type NewIgnoredDuplicate = typeof ignoredDuplicates.$inferInsert;
