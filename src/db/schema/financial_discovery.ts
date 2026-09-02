/**
 * Financial Discovery — a per-client/lead fact-find (income, expenses, assets,
 * liabilities, insurance, goals, advisor assessment) plus a cached computed
 * snapshot (net worth, surplus, SIP capacity, insurance gap, health score).
 *
 * One row per discovery. The full fact-find lives in `data` (jsonb, shaped by
 * src/lib/discovery/calc.ts:DiscoveryData); `computed` caches the derived
 * numbers so the list/dashboard can sort & filter without recomputing.
 *
 * Two fill paths share the same record: the in-meeting RM form (dashboard) and
 * the public client wizard (via a share_tokens link, kind 'financial_discovery').
 */

import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

export const financialDiscoveries = pgTable(
  "financial_discoveries",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),

    /** Who this discovery is about. */
    subjectType: text("subject_type", { enum: ["lead", "investor"] }).notNull(),
    subjectId: uuid("subject_id").notNull(),

    /** Snapshot of the client name for list display (data.identification is canonical). */
    title: text("title"),
    reviewType: text("review_type"),

    status: text("status", { enum: ["draft", "shared", "submitted", "reviewed"] }).notNull().default("draft"),

    /** Full fact-find — see DiscoveryData. */
    data: jsonb("data").notNull().default({}),
    /** Cached derived numbers — see DiscoveryComputed. */
    computed: jsonb("computed").notNull().default({}),
    /** Denormalised for list sort/filter. */
    healthScore: integer("health_score"),

    assignedRmId: uuid("assigned_rm_id").references(() => users.id),
    /** Most recent share link issued (share_tokens.id), if any. */
    lastShareTokenId: uuid("last_share_token_id"),

    sharedAt: timestamp("shared_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),

    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    subjectIdx: index("fin_discovery_subject_idx").on(t.tenantId, t.subjectType, t.subjectId),
    statusIdx: index("fin_discovery_status_idx").on(t.tenantId, t.status),
    scoreIdx: index("fin_discovery_score_idx").on(t.tenantId, t.healthScore),
  })
);

export type FinancialDiscovery = typeof financialDiscoveries.$inferSelect;
export type NewFinancialDiscovery = typeof financialDiscoveries.$inferInsert;
