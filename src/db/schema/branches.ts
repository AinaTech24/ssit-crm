import { jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";

export const branches = pgTable(
  "branches",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    name: text("name").notNull(),
    code: text("code").notNull(),
    address: jsonb("address").$type<{ line1?: string; city?: string; state?: string; pincode?: string }>(),
    phone: text("phone"),
    email: text("email"),
    headUserId: text("head_user_id"),
    isHq: text("is_hq").default("false"),
    ...timestamps,
  },
  (t) => ({
    codeUnique: uniqueIndex("branches_tenant_code_unique").on(t.tenantId, t.code),
  })
);

export type Branch = typeof branches.$inferSelect;
export type NewBranch = typeof branches.$inferInsert;
