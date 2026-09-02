import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { investors } from "./investors";
import { users } from "./users";

export const investorPortalAccess = pgTable(
  "investor_portal_access",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    investorId: uuid("investor_id").notNull().references(() => investors.id),
    tokenHash: text("token_hash").notNull(),
    scopes: jsonb("scopes")
      .$type<Array<"portfolio" | "goals" | "service_requests">>()
      .notNull()
      .default(["portfolio", "goals", "service_requests"]),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    tokenUnique: uniqueIndex("investor_portal_access_token_hash_unique").on(t.tokenHash),
    investorIdx: index("investor_portal_access_investor_idx").on(t.tenantId, t.investorId),
    expiryIdx: index("investor_portal_access_expiry_idx").on(t.expiresAt),
  })
);

export type InvestorPortalAccess = typeof investorPortalAccess.$inferSelect;

