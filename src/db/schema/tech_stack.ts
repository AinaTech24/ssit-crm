/**
 * MFD Tech Stack register — Network FP "MFD Tech Stack" + Login/Access +
 * Renewal/Expense trackers, consolidated.
 *
 * Records the firm's actual tools: what they are, what they're for, who has
 * access, cost and renewal date. Directly satisfies AMFI DDQ items III.1
 * (platform used for transactions) and VI.4 (software/apps used to service
 * clients). Tenant-scoped via RLS.
 */

import { date, index, numeric, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

export const TECH_CATEGORIES = [
  "practice_setup",     // workspace, website, calendar, storage, meetings
  "transactions",       // MFU / BSE StAR / NSE NMF / CAMS / KFin
  "practice_mgmt",      // Redvision, Investwell, MProfit, etc.
  "client_management",  // risk profiling, lead mgmt, WhatsApp, mailing
  "sales_marketing",    // Masterstroke, AnchorEDGE, Finpedia, design
  "research",           // Value Research, AdvisorKhoj, NGen
  "hr",                 // Zoho People, Keka
  "ai_tools",           // ChatGPT, Canva AI
  "other",
] as const;

export const TECH_STATUSES = ["active", "evaluating", "discontinued"] as const;

export const techStackTools = pgTable(
  "tech_stack_tools",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    category: text("category", { enum: TECH_CATEGORIES }).notNull().default("other"),
    toolName: text("tool_name").notNull(),
    purpose: text("purpose"),
    vendorUrl: text("vendor_url"),
    /** Who in the firm owns / administers this tool. */
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    /** Free-text note on who has login access (Login/Access Control tracker). */
    accessNote: text("access_note"),
    status: text("status", { enum: TECH_STATUSES }).notNull().default("active"),
    annualCost: numeric("annual_cost", { precision: 14, scale: 2 }),
    renewalDate: date("renewal_date"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    categoryIdx: index("tech_stack_category_idx").on(t.tenantId, t.category),
    renewalIdx: index("tech_stack_renewal_idx").on(t.tenantId, t.renewalDate),
  })
);

export type TechStackTool = typeof techStackTools.$inferSelect;
export type NewTechStackTool = typeof techStackTools.$inferInsert;
