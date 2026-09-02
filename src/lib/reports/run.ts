/**
 * Custom-report runner. Turns a saved-report definition into safe, tenant-
 * scoped, parameterized SQL by reusing the Filter AST compiler + catalog — the
 * exact same path segments use. Field keys are looked up in the catalog (which
 * throws on anything not declared there), and every value rides as a bind
 * param, so a tenant-authored report can't inject SQL.
 *
 * Two shapes:
 *   - runDetailed: SELECT <chosen catalog columns> … ORDER BY … LIMIT …
 *   - runMatrix:   GROUP BY <row field> [, <pivot field>] with COUNT/SUM,
 *                  pivoted into a cross-tab in JS.
 */
import type { Tx } from "@/db/client";
import { and, type FilterAST } from "@/lib/filter/ast";
import { getCatalog, getField, type FieldType } from "@/lib/filter/catalog";
import { compileToSql, bindCompiled } from "@/lib/filter/compiler";

export type ReportSubject = "investor" | "lead" | "task" | "user" | "transaction" | "sip" | "insurance" | "goal" | "service_request" | "claim";

export type ReportAggregate = "count" | "sum" | "avg" | "min" | "max";

/**
 * Build a SQL aggregate expression. `count` ignores the measure; the rest act
 * on a numeric cast of the catalog field's SQL fragment (which is never
 * user-controlled — it comes from the catalog).
 */
function aggExpr(fn: ReportAggregate, measureSql?: string): string {
  if (fn === "count") return "COUNT(*)";
  const m = `(${measureSql})::numeric`;
  switch (fn) {
    case "sum":
      return `COALESCE(SUM(${m}), 0)`;
    case "avg":
      return `AVG(${m})`;
    case "min":
      return `MIN(${m})`;
    case "max":
      return `MAX(${m})`;
  }
}

const AGG_LABEL: Record<ReportAggregate, string> = {
  count: "Count",
  sum: "Sum",
  avg: "Average",
  min: "Min",
  max: "Max",
};
export function aggLabel(fn: ReportAggregate): string {
  return AGG_LABEL[fn] ?? fn;
}

export interface DetailedColumn {
  key: string;
  label: string;
  type: FieldType;
}
export interface DetailedResult {
  kind: "detailed";
  columns: DetailedColumn[];
  rows: Record<string, unknown>[];
}

export interface MatrixDef {
  groupBy: string;
  pivot?: string;
  aggregate: ReportAggregate;
  measure?: string;
}
export interface MatrixResult {
  kind: "matrix";
  groupByLabel: string;
  colLabels: string[];
  rows: { key: string; cells: number[]; total: number }[];
  grandTotal: number;
  aggregate: ReportAggregate;
}

export interface SummaryAggregate {
  field: string;
  fn: ReportAggregate;
  label?: string;
}
export interface SummaryDef {
  groupBy: string[];
  columns?: string[];
  aggregates?: SummaryAggregate[];
  showDetailRows?: boolean;
  sort?: { field: string; dir: "asc" | "desc" } | null;
}
export interface SummaryGroupNode {
  key: string;
  count: number;
  /** Aggregate values, in the order of SummaryResult.aggregateDefs. */
  aggregates: number[];
  children?: SummaryGroupNode[];
  /** Detail rows (leaf level only, when showDetailRows). */
  rows?: Record<string, unknown>[];
}
export interface SummaryResult {
  kind: "summary";
  groupLabels: string[];
  aggregateDefs: { key: string; label: string; fn: ReportAggregate; type: FieldType }[];
  detailColumns: DetailedColumn[];
  showDetailRows: boolean;
  tree: SummaryGroupNode[];
  grand: { count: number; aggregates: number[] };
}

const MAX_ROWS = 5000;
const clampLimit = (n: unknown) => Math.min(Math.max(Math.trunc(Number(n) || 100), 1), MAX_ROWS);
const clampOffset = (n: unknown) => Math.max(Math.trunc(Number(n) || 0), 0);

/** First few catalog fields — the fallback column set for a detailed report. */
function defaultColumns(subject: string): string[] {
  return getCatalog(subject).fields.slice(0, 6).map((f) => f.key);
}

/**
 * Validate a report definition against the catalog. Throws (with a 400-ish
 * message) if any referenced field key is unknown — call before persisting.
 */
export function assertValidReport(def: {
  subject: string;
  reportType: "detailed" | "summary" | "matrix";
  columns?: string[] | null;
  sort?: { field: string; dir: "asc" | "desc" } | null;
  matrix?: MatrixDef | null;
  summary?: SummaryDef | null;
}): void {
  getCatalog(def.subject); // throws on unknown subject
  if (def.reportType === "detailed") {
    for (const k of def.columns ?? []) getField(def.subject, k);
    if (def.sort?.field) getField(def.subject, def.sort.field);
  } else if (def.reportType === "summary") {
    const s = def.summary;
    if (!s?.groupBy?.length) throw new Error("summary report needs at least one 'group by' field");
    if (s.groupBy.length > 3) throw new Error("summary report supports at most 3 grouping levels");
    for (const k of s.groupBy) getField(def.subject, k);
    for (const k of s.columns ?? []) getField(def.subject, k);
    for (const a of s.aggregates ?? []) {
      if (a.fn !== "count") {
        if (!a.field) throw new Error(`${a.fn} aggregate needs a field`);
        getField(def.subject, a.field);
      }
    }
    if (s.sort?.field) getField(def.subject, s.sort.field);
  } else {
    if (!def.matrix?.groupBy) throw new Error("matrix report needs a groupBy field");
    getField(def.subject, def.matrix.groupBy);
    if (def.matrix.pivot) getField(def.subject, def.matrix.pivot);
    if (def.matrix.aggregate !== "count") {
      if (!def.matrix.measure) throw new Error(`${def.matrix.aggregate} aggregate needs a measure field`);
      getField(def.subject, def.matrix.measure);
    }
  }
}

export async function runDetailed(
  tx: Tx,
  opts: {
    subject: string;
    ast: FilterAST | null | undefined;
    columns?: string[] | null;
    sort?: { field: string; dir: "asc" | "desc" } | null;
    tenantId: string;
    limit?: number;
    offset?: number;
  }
): Promise<DetailedResult> {
  const cat = getCatalog(opts.subject);
  const where = compileToSql(opts.ast ?? and(), opts.subject);
  const params = [...where.params, opts.tenantId];
  const tp = `$${params.length}`;

  const keys = opts.columns?.length ? opts.columns : defaultColumns(opts.subject);
  const colDefs = keys.map((k) => getField(opts.subject, k));
  const colSql = colDefs.map((d) => `${d.sql} AS "${d.key}"`).join(", ");

  let text = `SELECT ${colSql} FROM ${cat.table} ${cat.alias} WHERE ${cat.alias}.tenant_id = ${tp} AND ${where.sql}`;
  if (opts.sort?.field) {
    const sd = getField(opts.subject, opts.sort.field);
    text += ` ORDER BY ${sd.sql} ${opts.sort.dir === "desc" ? "DESC" : "ASC"} NULLS LAST`;
  }
  text += ` LIMIT ${clampLimit(opts.limit)} OFFSET ${clampOffset(opts.offset)}`;

  const res = await tx.execute(bindCompiled(text, params));
  return {
    kind: "detailed",
    columns: colDefs.map((d) => ({ key: d.key, label: d.label, type: d.type })),
    rows: res.rows as Record<string, unknown>[],
  };
}

export async function runMatrix(
  tx: Tx,
  opts: { subject: string; ast: FilterAST | null | undefined; matrix: MatrixDef; tenantId: string }
): Promise<MatrixResult> {
  const cat = getCatalog(opts.subject);
  const where = compileToSql(opts.ast ?? and(), opts.subject);
  const params = [...where.params, opts.tenantId];
  const tp = `$${params.length}`;

  const groupDef = getField(opts.subject, opts.matrix.groupBy);
  const measureSql =
    opts.matrix.aggregate !== "count" && opts.matrix.measure
      ? getField(opts.subject, opts.matrix.measure).sql
      : undefined;
  const agg = aggExpr(opts.matrix.aggregate, measureSql);

  const hasPivot = !!opts.matrix.pivot;
  let text: string;
  if (hasPivot) {
    const pivotDef = getField(opts.subject, opts.matrix.pivot!);
    text = `SELECT (${groupDef.sql})::text AS row_key, (${pivotDef.sql})::text AS col_key, ${agg}::numeric AS val
            FROM ${cat.table} ${cat.alias}
            WHERE ${cat.alias}.tenant_id = ${tp} AND ${where.sql}
            GROUP BY row_key, col_key ORDER BY row_key`;
  } else {
    text = `SELECT (${groupDef.sql})::text AS row_key, ${agg}::numeric AS val
            FROM ${cat.table} ${cat.alias}
            WHERE ${cat.alias}.tenant_id = ${tp} AND ${where.sql}
            GROUP BY row_key ORDER BY row_key`;
  }

  const res = await tx.execute(bindCompiled(text, params));
  const raw = res.rows as any[];

  if (hasPivot) {
    const colSet = new Set<string>();
    const rowMap = new Map<string, Record<string, number>>();
    for (const r of raw) {
      const rk = r.row_key ?? "—";
      const ck = r.col_key ?? "—";
      colSet.add(ck);
      if (!rowMap.has(rk)) rowMap.set(rk, {});
      rowMap.get(rk)![ck] = Number(r.val);
    }
    const colLabels = [...colSet].sort();
    let grandTotal = 0;
    const rows = [...rowMap.entries()].map(([rk, cells]) => {
      const arr = colLabels.map((c) => cells[c] ?? 0);
      const total = arr.reduce((s, v) => s + v, 0);
      grandTotal += total;
      return { key: rk, cells: arr, total };
    });
    return { kind: "matrix", groupByLabel: groupDef.label, colLabels, rows, grandTotal, aggregate: opts.matrix.aggregate };
  }

  const colLabel = opts.matrix.aggregate === "count" ? "Count" : aggLabel(opts.matrix.aggregate);
  let grandTotal = 0;
  const rows = raw.map((r) => {
    const v = Number(r.val);
    grandTotal += v;
    return { key: r.row_key ?? "—", cells: [v], total: v };
  });
  return { kind: "matrix", groupByLabel: groupDef.label, colLabels: [colLabel], rows, grandTotal, aggregate: opts.matrix.aggregate };
}

/**
 * Summary report: row grouping (1–3 levels) with per-group sub-totals + grand
 * totals computed by Postgres `GROUP BY ROLLUP`, plus optional detail rows
 * beneath each leaf group. ROLLUP means avg/min/max sub-totals are real
 * database aggregates at each level (not JS roll-ups of leaf values, which
 * would be wrong for average).
 */
export async function runSummary(
  tx: Tx,
  opts: { subject: string; ast: FilterAST | null | undefined; summary: SummaryDef; tenantId: string }
): Promise<SummaryResult> {
  const cat = getCatalog(opts.subject);
  const where = compileToSql(opts.ast ?? and(), opts.subject);
  const params = [...where.params, opts.tenantId];
  const tp = `$${params.length}`;

  const groupBy = (opts.summary.groupBy ?? []).slice(0, 3);
  const groupDefs = groupBy.map((k) => getField(opts.subject, k));
  const n = groupDefs.length;

  const aggDefs = (opts.summary.aggregates ?? []).map((a) => {
    const fieldDef = a.fn !== "count" && a.field ? getField(opts.subject, a.field) : null;
    return {
      key: `${a.fn}:${a.field ?? "*"}`,
      label: a.label ?? `${aggLabel(a.fn)}${fieldDef ? ` · ${fieldDef.label}` : ""}`,
      fn: a.fn,
      type: (a.fn === "count" ? "integer" : (fieldDef?.type ?? "number")) as FieldType,
      measureSql: fieldDef?.sql,
    };
  });

  const groupSel = groupDefs.map((d, i) => `(${d.sql})::text AS g${i}`).join(", ");
  const groupingSel = groupDefs.map((d, i) => `GROUPING((${d.sql})) AS gg${i}`).join(", ");
  const groupExprs = groupDefs.map((d) => `(${d.sql})`).join(", ");
  const aggSel = aggDefs.map((a, i) => `${aggExpr(a.fn, a.measureSql)}::numeric AS a${i}`).join(", ");

  const text = `SELECT ${groupSel}, ${groupingSel}, COUNT(*)::numeric AS _cnt${aggDefs.length ? ", " + aggSel : ""}
    FROM ${cat.table} ${cat.alias}
    WHERE ${cat.alias}.tenant_id = ${tp} AND ${where.sql}
    GROUP BY ROLLUP (${groupExprs})
    ORDER BY ${groupDefs.map((_, i) => `g${i} NULLS LAST`).join(", ")}`;

  const res = await tx.execute(bindCompiled(text, params));
  const raw = res.rows as any[];

  const aggsOf = (r: any): number[] => aggDefs.map((_, i) => Number(r[`a${i}`] ?? 0));
  const levelOf = (r: any): number => {
    let L = 0;
    for (let i = 0; i < n; i++) {
      if (Number(r[`gg${i}`]) === 1) break;
      L++;
    }
    return L;
  };
  const disp = (v: unknown) => (v == null || v === "" ? "—" : String(v));

  // Grand total = the all-rolled-up row (level 0).
  const grandRow = raw.find((r) => levelOf(r) === 0);
  const grand = { count: Number(grandRow?._cnt ?? 0), aggregates: grandRow ? aggsOf(grandRow) : aggDefs.map(() => 0) };

  // Build the group tree from the rollup rows (levels 1..n). ROLLUP emits a
  // parent's sub-total row AFTER its children (its rolled-up column sorts
  // NULLS LAST), so we build every node first, then link by level — that way a
  // child never looks up a parent that hasn't been created yet.
  const pathKey = (vals: string[]) => JSON.stringify(vals);
  const entries: { node: SummaryGroupNode; vals: string[]; L: number }[] = [];
  const byPath = new Map<string, { node: SummaryGroupNode; vals: string[]; L: number }>();
  for (const r of raw) {
    const L = levelOf(r);
    if (L < 1) continue;
    const vals = Array.from({ length: L }, (_, i) => disp(r[`g${i}`]));
    const node: SummaryGroupNode = { key: vals[L - 1], count: Number(r._cnt ?? 0), aggregates: aggsOf(r) };
    const entry = { node, vals, L };
    entries.push(entry);
    byPath.set(pathKey(vals), entry);
  }
  const roots: SummaryGroupNode[] = [];
  for (let lvl = 1; lvl <= n; lvl++) {
    for (const e of entries) {
      if (e.L !== lvl) continue;
      if (lvl === 1) roots.push(e.node);
      else {
        const parent = byPath.get(pathKey(e.vals.slice(0, lvl - 1)));
        if (parent) (parent.node.children ??= []).push(e.node);
      }
    }
  }

  // Detail rows (leaf level), bucketed under their leaf group.
  const showDetail = !!opts.summary.showDetailRows;
  const colKeys = opts.summary.columns?.length ? opts.summary.columns : defaultColumns(opts.subject);
  const colDefs = colKeys.map((k) => getField(opts.subject, k));
  if (showDetail && n > 0) {
    const pathSel = groupDefs.map((d, i) => `(${d.sql})::text AS gp${i}`).join(", ");
    const colSql = colDefs.map((d) => `${d.sql} AS "${d.key}"`).join(", ");
    let dtext = `SELECT ${pathSel}, ${colSql} FROM ${cat.table} ${cat.alias}
      WHERE ${cat.alias}.tenant_id = ${tp} AND ${where.sql}
      ORDER BY ${groupDefs.map((_, i) => `gp${i} NULLS LAST`).join(", ")}`;
    if (opts.summary.sort?.field) {
      const sd = getField(opts.subject, opts.summary.sort.field);
      dtext += `, ${sd.sql} ${opts.summary.sort.dir === "desc" ? "DESC" : "ASC"} NULLS LAST`;
    }
    dtext += ` LIMIT ${MAX_ROWS}`;
    const dres = await tx.execute(bindCompiled(dtext, params));
    for (const row of dres.rows as any[]) {
      const vals = Array.from({ length: n }, (_, i) => disp(row[`gp${i}`]));
      const leaf = byPath.get(pathKey(vals));
      if (leaf) (leaf.node.rows ??= []).push(row as Record<string, unknown>);
    }
  }

  return {
    kind: "summary",
    groupLabels: groupDefs.map((d) => d.label),
    aggregateDefs: aggDefs.map((a) => ({ key: a.key, label: a.label, fn: a.fn, type: a.type })),
    detailColumns: colDefs.map((d) => ({ key: d.key, label: d.label, type: d.type })),
    showDetailRows: showDetail,
    tree: roots,
    grand,
  };
}
