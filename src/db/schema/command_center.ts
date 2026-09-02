import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";

/**
 * Per-user snooze / dismiss state for Command Center triage items. Keyed by a
 * stable item key ("<groupKey>:<id>"). The queue builder excludes rows that are
 * dismissed or still within their snooze window. Migration 0134.
 */
export const commandCenterSnoozes = pgTable(
  "command_center_snoozes",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    userId: uuid("user_id").notNull(),
    itemKey: text("item_key").notNull(),
    /** When the item should resurface; NULL when permanently dismissed. */
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    dismissed: boolean("dismissed").notNull().default(false),
    ...timestamps,
  },
  (t) => ({
    uq: uniqueIndex("cc_snooze_uq").on(t.tenantId, t.userId, t.itemKey),
    activeIdx: index("cc_snooze_active_idx").on(t.tenantId, t.userId, t.snoozedUntil),
  })
);

export type CommandCenterSnooze = typeof commandCenterSnoozes.$inferSelect;
