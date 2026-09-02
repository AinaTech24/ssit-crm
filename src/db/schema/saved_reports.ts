import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { branches } from "./branches";
import { users } from "./users";

/**
 * User-defined ("custom") reports — the self-serve report builder.
 *
 * A saved report is a stored query over one catalog subject (investor / lead /
 * task / user), reusing the Filter AST (src/lib/filter). Two output shapes:
 *   - detailed: a column list rendered as a table
 *   - matrix:   a group-by (+ optional pivot) cross-tab of count/sum
 *
 * The pre-built MIS catalog (src/app/dashboard/reports) stays as-is; this is
 * the additive "build your own" surface. Run/export compile the AST to safe,
 * parameterized SQL — exactly like segments — so there's no injection surface.
 */
export const REPORT_SUBJECTS = [
  "investor",
  "lead",
  "task",
  "user",
  "transaction",
  "sip",
  "insurance",
  "goal",
  "service_request",
  "claim",
] as const;
export const REPORT_TYPES = ["detailed", "summary", "matrix"] as const;
export const REPORT_SHARE_SCOPES = ["private", "team", "tenant"] as const;
/** Aggregate functions available on matrix + summary reports. */
export const REPORT_AGGREGATES = ["count", "sum", "avg", "min", "max"] as const;
export type ReportAggregate = (typeof REPORT_AGGREGATES)[number];

export const savedReports = pgTable(
  "saved_reports",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    branchId: uuid("branch_id").references(() => branches.id),

    name: text("name").notNull(),
    description: text("description"),

    /** Catalog subject the report queries. */
    subject: text("subject", { enum: REPORT_SUBJECTS }).notNull(),
    reportType: text("report_type", { enum: REPORT_TYPES }).notNull().default("detailed"),

    /** Filter AST (a Group) — see src/lib/filter/ast.ts. Null = no filter. */
    ast: jsonb("ast"),

    /** Detailed reports: ordered list of catalog field keys to show. */
    columns: jsonb("columns").$type<string[]>().default([]),
    /** Sort: { field, dir }. */
    sort: jsonb("sort").$type<{ field: string; dir: "asc" | "desc" } | null>(),

    /**
     * Matrix reports: how to pivot.
     *   groupBy  — catalog field key for the rows
     *   pivot    — optional catalog field key for the columns (cross-tab)
     *   aggregate— 'count' | 'sum' | 'avg' | 'min' | 'max'
     *   measure  — field key the aggregate acts on (required for all but count)
     */
    matrix: jsonb("matrix").$type<{
      groupBy: string;
      pivot?: string;
      aggregate: ReportAggregate;
      measure?: string;
    } | null>(),

    /**
     * Summary reports: row grouping with detail rows + sub/grand totals.
     *   groupBy     — 1..3 catalog field keys; nested groups in order
     *   columns     — detail-row columns (shown when showDetailRows=true)
     *   aggregates  — per-group aggregate columns ({ field, fn, label? })
     *   showDetailRows — show the underlying rows beneath each group header
     *   sort        — sort within each group's detail rows
     */
    summary: jsonb("summary").$type<{
      groupBy: string[];
      columns: string[];
      aggregates: { field: string; fn: ReportAggregate; label?: string }[];
      showDetailRows: boolean;
      sort?: { field: string; dir: "asc" | "desc" } | null;
    } | null>(),

    /** Optional folder to organise the report under (Zoho-style). */
    folder: text("folder"),

    /** Optional chart on the result (rendered on the view page). */
    chartType: text("chart_type", { enum: ["none", "bar", "pie", "line", "area", "donut"] }).default("none"),

    /** Who can see it. private = creator only; team = same branch; tenant = all. */
    sharedScope: text("shared_scope", { enum: REPORT_SHARE_SCOPES }).notNull().default("private"),

    createdById: uuid("created_by_id").references(() => users.id),
    /** User ids who starred it (per-user favourite). */
    starredBy: jsonb("starred_by").$type<string[]>().default([]),

    /**
     * Optional email schedule. NULL or enabled=false = manual-run only.
     * The report-scheduler worker emails the rendered report to `emails`
     * at `hour` on the matching cadence (weekly: day=0-6, monthly: day=1-28).
     */
    schedule: jsonb("schedule").$type<{
      freq: "daily" | "weekly" | "monthly";
      hour: number;
      day?: number;
      emails: string[];
      enabled: boolean;
    } | null>(),
    /** Last time the scheduler delivered this report (dedup guard). */
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),

    ...timestamps,
  },
  (t) => ({
    tenantIdx: index("saved_reports_tenant_idx").on(t.tenantId, t.updatedAt),
    subjectIdx: index("saved_reports_subject_idx").on(t.tenantId, t.subject),
    creatorIdx: index("saved_reports_creator_idx").on(t.tenantId, t.createdById),
  })
);

export type SavedReport = typeof savedReports.$inferSelect;
export type NewSavedReport = typeof savedReports.$inferInsert;
