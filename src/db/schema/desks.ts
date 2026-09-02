import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { branches } from "./branches";

/**
 * Desk — a sub-branch reporting unit (e.g. "DK", "RC", "1" under the Anand
 * branch). The firm's real operating hierarchy is Branch → Desk → RM: each desk
 * groups several RMs, and the monthly MIS rolls up desk → branch → firm. Users
 * are assigned to a desk via users.desk_id.
 */
export const desks = pgTable(
  "desks",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    name: text("name").notNull(),
    /** Short code shown in report row labels, e.g. "DK", "RC", "1". */
    code: text("code"),
    ...timestamps,
  },
  (t) => ({
    branchIdx: index("desks_tenant_branch_idx").on(t.tenantId, t.branchId),
    nameUnique: uniqueIndex("desks_branch_name_unique").on(t.tenantId, t.branchId, t.name),
  })
);

export type Desk = typeof desks.$inferSelect;
export type NewDesk = typeof desks.$inferInsert;
