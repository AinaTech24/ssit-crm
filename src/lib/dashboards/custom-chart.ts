/**
 * Custom-chart engine — the Zoho-style "build your own component" core.
 *
 * A custom dashboard component is defined declaratively as:
 *   { subject, chartType, agg, field?, groupBy?, dateGrain?, ast? }
 * i.e. "on MODULE, plot CHART of MEASURE (count / sum / avg / … of a field)
 *       grouped by DIMENSION, filtered by FILTERS".
 *
 * This module turns that definition into a safe, parameterised aggregate SQL
 * query (reusing the field catalog's per-field `.sql` fragments — never user
 * input — and the filter compiler for the WHERE clause) plus the `view`
 * descriptor the existing WidgetView renderer already understands.
 */

import { CATALOGS, getCatalog, type FieldDef } from "@/lib/filter/catalog";
import { compileToSql } from "@/lib/filter/compiler";
import { FilterASTSchema, type FilterAST } from "@/lib/filter/ast";

export type ChartType =
  | "kpi"
  | "column"
  | "bar"
  | "line"
  | "area"
  | "pie"
  | "donut"
  | "funnel"
  | "table";

export type Agg = "count" | "count_unique" | "sum" | "avg" | "min" | "max";
export type DateGrain = "day" | "week" | "month" | "quarter" | "year";

export interface CustomChartConfig {
  /** Catalog subject: lead | investor | task | transaction | user … */
  subject: string;
  chartType: ChartType;
  agg: Agg;
  /** Measure field key — required for everything except a plain count. */
  field?: string;
  /** Dimension field key — required for every chart except a single KPI. */
  groupBy?: string;
  /** Bucketing for a date/datetime dimension. */
  dateGrain?: DateGrain;
  /** Max categories (charts). Defaults to 20. */
  limit?: number;
  /** Optional filter AST (same language as segments). */
  ast?: FilterAST;
  /** Display title override. */
  title?: string;
}

/** Subjects exposed in the builder, with friendly module labels. Every catalog
 *  module is available — add a catalog and it shows up here. */
export const CHART_SUBJECTS: Array<{ subject: string; label: string }> = [
  { subject: "lead", label: "Leads" },
  { subject: "investor", label: "Clients" },
  { subject: "business_entry", label: "Transactions" },
  { subject: "transaction", label: "Transactions" },
  { subject: "review_meeting", label: "Meetings" },
  { subject: "task", label: "Tasks" },
  { subject: "sip", label: "SIPs" },
  { subject: "insurance", label: "Insurance" },
  { subject: "goal", label: "Goals" },
  { subject: "service_request", label: "Service Requests" },
  { subject: "claim", label: "Claims" },
  { subject: "user", label: "Team" },
].filter((s) => CATALOGS[s.subject]);

const NUMERIC_TYPES = new Set(["integer", "number", "currency"]);
const DATE_TYPES = new Set(["date", "datetime"]);

/** A field usable as an X-axis / grouping dimension. */
export function isDimension(f: FieldDef): boolean {
  return ["enum", "string", "uuid", "boolean", "integer", "date", "datetime"].includes(f.type);
}
/** A field usable as a numeric measure (sum/avg/min/max). */
export function isMeasure(f: FieldDef): boolean {
  return NUMERIC_TYPES.has(f.type);
}

/** Builder metadata for one subject — what can be grouped vs measured. */
export function chartFieldsFor(subject: string) {
  const cat = CATALOGS[subject];
  if (!cat) return { dimensions: [], measures: [] };
  return {
    dimensions: cat.fields.filter(isDimension).map((f) => ({ key: f.key, label: f.label, type: f.type })),
    measures: cat.fields.filter(isMeasure).map((f) => ({ key: f.key, label: f.label, type: f.type })),
  };
}

const AGG_FN: Record<Exclude<Agg, "count" | "count_unique">, string> = {
  sum: "SUM",
  avg: "AVG",
  min: "MIN",
  max: "MAX",
};

function dimExpr(f: FieldDef, grain: DateGrain | undefined): { groupSql: string; labelSql: string } {
  if (DATE_TYPES.has(f.type)) {
    const g = grain ?? "month";
    const trunc = `date_trunc('${g}', ${f.sql})`;
    const fmt =
      g === "year" ? "YYYY" : g === "month" ? "Mon YYYY" : g === "quarter" ? '"Q"Q YYYY' : "DD Mon YYYY";
    // Group on the truncated timestamp; show a friendly formatted label.
    return { groupSql: trunc, labelSql: `to_char(${trunc}, '${fmt}')` };
  }
  // Non-date dimension — group + label on the raw column, NULL → "None".
  const coalesced = `COALESCE(${f.sql}::text, 'None')`;
  return { groupSql: f.sql, labelSql: coalesced };
}

export interface BuiltChart {
  sql: string;
  params: unknown[];
  /** `view` descriptor the WidgetView renderer consumes. */
  view: any;
  /** bar | line | area | column hint for the "chart" view kind. */
  chart?: string;
}

/**
 * Compile a custom-chart config into a parameterised aggregate query + the
 * render descriptor. Throws a clear Error on any invalid subject/field/combo so
 * the API returns 400, never a 500.
 */
export function buildCustomChart(config: CustomChartConfig, tenantId: string): BuiltChart {
  const cat = getCatalog(config.subject); // throws on unknown subject
  const byKey = new Map(cat.fields.map((f) => [f.key, f]));

  // ── measure expression ────────────────────────────────────────────────────
  let aggExpr: string;
  let measureType: string = "integer";
  let measureLabel: string;
  if (config.agg === "count") {
    aggExpr = "COUNT(*)";
    measureLabel = "Count";
  } else {
    if (!config.field) throw new Error("A field is required for this measure.");
    const mf = byKey.get(config.field);
    if (!mf) throw new Error(`Unknown field "${config.field}".`);
    if (config.agg === "count_unique") {
      aggExpr = `COUNT(DISTINCT ${mf.sql})`;
      measureLabel = `Unique ${mf.label}`;
    } else {
      if (!isMeasure(mf)) throw new Error(`"${mf.label}" is not numeric — pick a number field to ${config.agg}.`);
      aggExpr = `${AGG_FN[config.agg]}(${mf.sql})`;
      measureType = mf.type;
      measureLabel = `${config.agg[0].toUpperCase()}${config.agg.slice(1)} of ${mf.label}`;
    }
  }
  const format = measureType === "currency" ? "inr" : "number";

  // ── WHERE (filters → SQL) + tenant scope ──────────────────────────────────
  const ast: FilterAST = config.ast
    ? FilterASTSchema.parse(config.ast)
    : { type: "group", op: "AND", children: [] };
  const { sql: whereSql, params } = compileToSql(ast, config.subject);
  params.push(tenantId);
  const tIdx = params.length;
  const where = `${cat.alias}.tenant_id = $${tIdx} AND (${whereSql})`;
  const from = `FROM ${cat.table} ${cat.alias} WHERE ${where}`;

  // ── KPI (single number, no grouping) ──────────────────────────────────────
  if (config.chartType === "kpi" || !config.groupBy) {
    return {
      sql: `SELECT ${aggExpr} AS value ${from}`,
      params,
      view: { kind: "kpi", valueKey: "value", format },
    };
  }

  // ── grouped charts ────────────────────────────────────────────────────────
  const gf = byKey.get(config.groupBy);
  if (!gf) throw new Error(`Unknown group-by field "${config.groupBy}".`);
  if (!isDimension(gf)) throw new Error(`"${gf.label}" can't be used to group.`);
  const { groupSql, labelSql } = dimExpr(gf, config.dateGrain);
  const isDate = DATE_TYPES.has(gf.type);
  const limit = Math.min(Math.max(Number(config.limit) || 20, 1), 50);
  // Date dimensions read best chronologically; everything else, biggest-first.
  const order = isDate ? `${groupSql} ASC` : `value DESC NULLS LAST`;

  const sql =
    `SELECT ${labelSql} AS label, ${aggExpr} AS value ` +
    `${from} GROUP BY ${groupSql}${isDate ? "" : `, ${labelSql}`} ORDER BY ${order} LIMIT ${limit}`;

  switch (config.chartType) {
    case "pie":
    case "donut":
      return { sql, params, view: { kind: "donut", labelKey: "label", valueKey: "value", format } };
    case "funnel":
      return { sql, params, view: { kind: "funnel", labelKey: "label", valueKey: "value" } };
    case "table":
      return {
        sql,
        params,
        view: {
          kind: "table",
          columns: [
            { key: "label", label: gf.label },
            { key: "value", label: measureLabel, format: format === "inr" ? "inr" : "number" },
          ],
        },
      };
    case "line":
    case "area":
    case "bar":
    case "column":
    default:
      return {
        sql,
        params,
        view: { kind: "chart", x: "label", series: [{ key: "value", label: measureLabel }], format },
        // recharts BarChart renders vertical columns, so bar + column both map to "bar".
        chart: config.chartType === "line" ? "line" : config.chartType === "area" ? "area" : "bar",
      };
  }
}
