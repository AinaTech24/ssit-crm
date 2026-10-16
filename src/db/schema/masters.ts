/**
 * Master lookup tables (admin-configurable).
 *
 * The spec calls for 15 masters in section 26. We collapse them into a single
 * generic `master_values` table keyed by (tenant_id, master_type, key) — this
 * is significantly more flexible than 15 separate tables, supports custom
 * fields per master via a `meta` jsonb, and removes the need for 15 migrations
 * when a new master is needed.
 *
 * Two exceptions get their own tables:
 *   - `amc_master`     (AMC catalogue) — has scheme children + RTA mapping
 *   - `scheme_master`  (Scheme catalogue) — linked to amc_master
 * These are large enough (50+ AMCs, thousands of schemes) and have enough
 * structure that a dedicated table reads better.
 */

import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";

/**
 * Single master_values table covers:
 *   - lead_source, lead_event, campaign_type, service_request_type, task_priority,
 *     client_category, goal_type, risk_profile_level, ddq_checklist_item,
 *     document_type, user_role, branch (when not first-class), rm (alias of users)
 *
 * `master_type` is the discriminator. `key` is the stable identifier referenced
 * from other tables; `label` is the human display string.
 */
export const masterValues = pgTable(
  "master_values",
  {
    id,
    tenantId: tenantId, // null tenantId means platform-default (seedable)
    masterType: text("master_type", {
      enum: [
        "lead_source",
        // Named events a lead can be attributed to when source="event".
        // Managed inline from the New-lead form via /api/lead-events.
        "lead_event",
        // Partners a service request is raised with (RTA, AMC desks, brokers).
        // Managed inline from the New service request form.
        "service_partner",
        "campaign_type",
        "service_request_type",
        "task_priority",
        "client_category",
        "goal_type",
        "risk_profile_level",
        "ddq_checklist_item",
        "document_type",
        "user_role",
        "interest_product",
        "occupation",
        "income_range",
        "meeting_type",
        "relationship",
      ],
    }).notNull(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").default(0),
    isActive: boolean("is_active").notNull().default(true),
    isSystemDefault: boolean("is_system_default").default(false),
    meta: jsonb("meta"), // per-type extra fields (e.g. SLA hours for service_request_type)
    ...timestamps,
  },
  (t) => ({
    typeKeyUnique: uniqueIndex("master_values_unique").on(t.tenantId, t.masterType, t.key),
    typeActiveIdx: index("master_values_type_idx").on(t.tenantId, t.masterType, t.isActive),
  })
);

/**
 * AMC master — has its own table because it's referenced across folios,
 * transactions, empanelment docs, AMC creatives. Tenant-scoped because not
 * every MFD is empaneled with every AMC.
 */
export const amcMaster = pgTable(
  "amc_master",
  {
    id,
    tenantId: tenantId,
    code: text("code").notNull(), // canonical AMC code (e.g. 'HDFC', 'AXIS')
    name: text("name").notNull(),
    rta: text("rta", { enum: ["cams", "kfintech", "sundaram", "franklin", "other"] }),
    isEmpaneled: boolean("is_empaneled").default(false),
    empanelmentNumber: text("empanelment_number"),
    empanelmentDate: text("empanelment_date"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    relationshipManager: text("relationship_manager"), // AMC-side RM name
    logoUrl: text("logo_url"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => ({
    codeUnique: uniqueIndex("amc_master_tenant_code_unique").on(t.tenantId, t.code),
  })
);

/**
 * Scheme master — children of AMC. The scheme list is large (thousands of
 * schemes) so we expect this to be seeded from RTA feeds + AMFI master file.
 */
export const schemeMaster = pgTable(
  "scheme_master",
  {
    id,
    tenantId: tenantId,
    amcCode: text("amc_code").notNull(),
    schemeCode: text("scheme_code").notNull(),
    schemeName: text("scheme_name").notNull(),
    category: text("category"), // e.g. 'Equity - Large Cap', 'Hybrid - Aggressive'
    subCategory: text("sub_category"),
    plan: text("plan", { enum: ["regular", "direct"] }),
    option: text("option", { enum: ["growth", "idcw_payout", "idcw_reinvest"] }),
    minInvestment: text("min_investment"),
    minSip: text("min_sip"),
    exitLoad: text("exit_load"),
    riskCategory: text("risk_category"), // very_low, low, moderate, high, very_high
    isActive: boolean("is_active").notNull().default(true),
    isClosed: boolean("is_closed").default(false),

    /**
     * Shortlist (Network FP "3.1 AMC Schemes" parity, migration 0026) —
     * the firm's investment-committee buy list. Distinct from `isActive`
     * (which is "available in our catalog"). RM proposals SHOULD pick
     * from shortlisted schemes; non-shortlist picks should require a
     * justification field (future work).
     */
    isShortlisted: boolean("is_shortlisted").default(false),
    shortlistedAt: timestamp("shortlisted_at", { withTimezone: true }),
    shortlistedBy: uuid("shortlisted_by"),
    shortlistRationale: text("shortlist_rationale"),
    /**
     * Coarse category bucket for the shortlist UI — separate from the
     * fine-grained `category` ("Equity - Large Cap"). One of:
     *   'equity' | 'hybrid' | 'debt' | 'liquid' | 'commodity'
     *   | 'international' | 'other'
     */
    coarseCategory: text("coarse_category"),

    /**
     * IC scorecard snapshot — Network FP "3.3 MF Selection" parity.
     * Captures the 11 criteria the IC used at the time of shortlisting.
     * Compare snapshots across reviews to defensibly de-shortlist when
     * criteria degrade.
     */
    evaluation: jsonb("evaluation").$type<{
      fundCategoryNote?: string;
      fundObjective?: string;
      schemeRiskProfile?: "low" | "moderate" | "high" | "very_high";
      fmName?: string;
      fmExperienceYears?: number;
      amcReputationNote?: string;
      fiveYearCagrPct?: number;
      consistencyPct?: number;
      sharpeRatio?: number;
      stdDevPct?: number;
      expenseRatioPct?: number;
      portfolioCompositionNote?: string;
      aumCrore?: number;
      liquidityNote?: string;
      verdict?: "pass" | "watch" | "reject";
      evaluatedAt?: string;
      evaluatedBy?: string;
    }>(),
    ...timestamps,
  },
  (t) => ({
    schemeUnique: uniqueIndex("scheme_master_unique").on(t.tenantId, t.amcCode, t.schemeCode),
    categoryIdx: index("scheme_master_category_idx").on(t.tenantId, t.category, t.isActive),
  })
);

export type MasterValue = typeof masterValues.$inferSelect;
export type AmcMaster = typeof amcMaster.$inferSelect;
export type SchemeMaster = typeof schemeMaster.$inferSelect;
