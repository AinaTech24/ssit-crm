import { type FilterAST, type Predicate, isGroup, isPredicate, type FieldRef, type FilterOperator, astDepth, MAX_AST_DEPTH } from "./ast";
import { getCatalog, getField, type FieldDef, type SubjectCatalog } from "./catalog";

/** Longest regex a `matches` predicate may carry — a crude ReDoS guard that
 *  pairs with the statement_timeout the preview/materializer set. */
const MAX_REGEX_LEN = 200;

/**
 * Compiles a FilterAST into a parameterized SQL fragment safe to drop into
 * a WHERE clause. Returns `{ sql, params }` where `params` is a positional
 * array; the SQL uses `$1, $2, ...` placeholders.
 *
 * Tenancy: the caller is responsible for adding `<alias>.tenant_id = $N`
 * (or relying on RLS). This compiler scopes per-row predicates only.
 */
export interface CompileResult {
  sql: string;
  params: unknown[];
  /** Tables that need to be JOINed beyond the primary subject table. */
  joins: string[];
}

class Compiler {
  /** Public so compileToSelect() can append a tenant-id param after compiling. */
  params: unknown[] = [];
  private joins = new Set<string>();
  private catalog: SubjectCatalog;

  constructor(subject: string) {
    this.catalog = getCatalog(subject);
  }

  private bind(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  private resolveField(field: FieldRef): { sql: string; def?: FieldDef } {
    if (field.kind === "attr") {
      const def = getField(this.catalog.subject, field.path);
      return { sql: def.sql, def };
    }
    if (field.kind === "computed") {
      const def = getField(this.catalog.subject, field.key);
      return { sql: def.sql, def };
    }
    if (field.kind === "rel") {
      const rel = this.catalog.relations[field.rel];
      if (!rel) throw new Error(`Unknown relation: ${this.catalog.subject}.${field.rel}`);
      // Build a correlated subquery
      const subCompiler = new Compiler(this.catalog.subject); // catalog stays the same for relation children that reference back; advanced: support nested subject change later
      const inner = subCompiler.compileNode(field.predicate);
      // Stitch params from sub
      const paramBase = this.params.length;
      for (const p of subCompiler.params) this.params.push(p);
      // Renumber params: not necessary because compiler doesn't re-bind shared state; we always pushed fresh
      // (subCompiler shares no state — its $1 must be remapped)
      const innerSql = renumberPlaceholders(inner.sql, paramBase);
      let quantifierSql: string;
      const quantifier = field.quantifier ?? "any";
      switch (quantifier) {
        case "any":
          quantifierSql = `EXISTS (SELECT 1 FROM ${rel.table} ${rel.alias} WHERE ${rel.joinSql} AND ${innerSql})`;
          break;
        case "none":
          quantifierSql = `NOT EXISTS (SELECT 1 FROM ${rel.table} ${rel.alias} WHERE ${rel.joinSql} AND ${innerSql})`;
          break;
        case "all":
          // "all matching predicate" = no row exists that does NOT match
          quantifierSql = `NOT EXISTS (SELECT 1 FROM ${rel.table} ${rel.alias} WHERE ${rel.joinSql} AND NOT (${innerSql}))`;
          break;
        case "count_gte":
          if (typeof field.count !== "number") throw new Error("count_gte requires count");
          quantifierSql = `(SELECT COUNT(*) FROM ${rel.table} ${rel.alias} WHERE ${rel.joinSql} AND ${innerSql}) >= ${this.bind(field.count)}`;
          break;
        case "count_lte":
          if (typeof field.count !== "number") throw new Error("count_lte requires count");
          quantifierSql = `(SELECT COUNT(*) FROM ${rel.table} ${rel.alias} WHERE ${rel.joinSql} AND ${innerSql}) <= ${this.bind(field.count)}`;
          break;
      }
      // We don't use joins; we use correlated EXISTS.
      return { sql: `(${quantifierSql})` };
    }
    throw new Error("Unreachable field ref");
  }

  private compilePredicate(node: Predicate): string {
    // Relation predicates short-circuit: they don't have op/value
    if (node.field.kind === "rel") {
      const { sql } = this.resolveField(node.field);
      return sql;
    }

    const { sql: fieldSql, def } = this.resolveField(node.field);
    if (!def) throw new Error("Field def missing");
    if (!def.ops.includes(node.op)) {
      throw new Error(`Operator '${node.op}' not allowed for field '${def.key}'`);
    }

    switch (node.op) {
      case "eq":
        return `${fieldSql} = ${this.bind(node.value)}`;
      case "ne":
        return `${fieldSql} <> ${this.bind(node.value)}`;
      case "gt":
        return `${fieldSql} > ${this.bind(node.value)}`;
      case "gte":
        return `${fieldSql} >= ${this.bind(node.value)}`;
      case "lt":
        return `${fieldSql} < ${this.bind(node.value)}`;
      case "lte":
        return `${fieldSql} <= ${this.bind(node.value)}`;
      case "contains":
        return `${fieldSql} ILIKE ${this.bind(`%${escapeLike(String(node.value ?? ""))}%`)}`;
      case "not_contains":
        return `${fieldSql} NOT ILIKE ${this.bind(`%${escapeLike(String(node.value ?? ""))}%`)}`;
      case "starts_with":
        return `${fieldSql} ILIKE ${this.bind(`${escapeLike(String(node.value ?? ""))}%`)}`;
      case "ends_with":
        return `${fieldSql} ILIKE ${this.bind(`%${escapeLike(String(node.value ?? ""))}`)}`;
      case "matches": {
        // Postgres POSIX regex. Bound as a parameter (no injection), but cap the
        // length to blunt catastrophic-backtracking (ReDoS) patterns.
        const pat = String(node.value ?? "");
        if (pat.length > MAX_REGEX_LEN) {
          throw new Error(`Regex pattern too long (max ${MAX_REGEX_LEN} chars)`);
        }
        return `${fieldSql} ~ ${this.bind(pat)}`;
      }
      case "in": {
        const arr = Array.isArray(node.value) ? node.value : [];
        if (arr.length === 0) return "FALSE";
        const placeholders = arr.map((v) => this.bind(v)).join(",");
        return `${fieldSql} IN (${placeholders})`;
      }
      case "not_in": {
        const arr = Array.isArray(node.value) ? node.value : [];
        if (arr.length === 0) return "TRUE";
        const placeholders = arr.map((v) => this.bind(v)).join(",");
        return `${fieldSql} NOT IN (${placeholders})`;
      }
      case "between": {
        const arr = Array.isArray(node.value) ? node.value : [];
        if (arr.length !== 2) throw new Error("between requires [from, to]");
        return `${fieldSql} BETWEEN ${this.bind(arr[0])} AND ${this.bind(arr[1])}`;
      }
      case "not_between": {
        const arr = Array.isArray(node.value) ? node.value : [];
        if (arr.length !== 2) throw new Error("not_between requires [from, to]");
        return `${fieldSql} NOT BETWEEN ${this.bind(arr[0])} AND ${this.bind(arr[1])}`;
      }
      case "is_empty":
        return `(${fieldSql} IS NULL OR ${fieldSql} = '')`;
      case "is_not_empty":
        return `(${fieldSql} IS NOT NULL AND ${fieldSql} <> '')`;
      case "is_null":
        return `${fieldSql} IS NULL`;
      case "is_not_null":
        return `${fieldSql} IS NOT NULL`;
      case "is_true":
        return `${fieldSql} = TRUE`;
      case "is_false":
        return `${fieldSql} = FALSE`;
      case "date_today":
        return `${fieldSql}::date = CURRENT_DATE`;
      case "date_yesterday":
        return `${fieldSql}::date = CURRENT_DATE - INTERVAL '1 day'`;
      case "date_tomorrow":
        return `${fieldSql}::date = CURRENT_DATE + INTERVAL '1 day'`;
      case "date_is_anniversary":
        // Match by month-day, ignoring year — used for birthdays + anniversaries
        return `to_char(${fieldSql}, 'MM-DD') = to_char(CURRENT_DATE, 'MM-DD')`;
      case "date_within": {
        const d = node.duration ?? toDuration(node.value);
        return `${fieldSql} >= now() - INTERVAL '${intervalSql(d)}'`;
      }
      case "date_in_last": {
        const d = node.duration ?? toDuration(node.value);
        return `${fieldSql} >= now() - INTERVAL '${intervalSql(d)}' AND ${fieldSql} <= now()`;
      }
      case "date_in_next": {
        const d = node.duration ?? toDuration(node.value);
        return `${fieldSql} >= now() AND ${fieldSql} <= now() + INTERVAL '${intervalSql(d)}'`;
      }
      case "date_before":
        return `${fieldSql} < ${this.bind(node.value)}`;
      case "date_after":
        return `${fieldSql} > ${this.bind(node.value)}`;
      default: {
        const exhaustive: never = node.op;
        throw new Error(`Unhandled operator: ${exhaustive}`);
      }
    }
  }

  compileNode(node: FilterAST): CompileResult {
    let sql: string;
    if (isGroup(node)) {
      if (node.children.length === 0) {
        sql = node.op === "AND" ? "TRUE" : "FALSE";
      } else {
        const parts = node.children.map((c) => this.compileNode(c).sql);
        sql = "(" + parts.join(` ${node.op} `) + ")";
      }
      if (node.not) sql = `NOT ${sql}`;
    } else if (isPredicate(node)) {
      sql = this.compilePredicate(node);
    } else {
      throw new Error("Unknown AST node");
    }
    return { sql, params: this.params, joins: [...this.joins] };
  }
}

export function compileToSql(ast: FilterAST, subject: string): CompileResult {
  if (astDepth(ast) > MAX_AST_DEPTH) {
    throw new Error(`Filter is nested too deeply (max ${MAX_AST_DEPTH} levels)`);
  }
  const c = new Compiler(subject);
  return c.compileNode(ast);
}

/**
 * Build a full SELECT for use by segment materializer / preview API.
 */
export function compileToSelect(
  ast: FilterAST,
  subject: string,
  opts: { columns?: string[]; limit?: number; offset?: number; count?: boolean; tenantId?: string } = {}
): CompileResult {
  if (astDepth(ast) > MAX_AST_DEPTH) {
    throw new Error(`Filter is nested too deeply (max ${MAX_AST_DEPTH} levels)`);
  }
  const c = new Compiler(subject);
  const { sql: where, params } = c.compileNode(ast);
  const cat = getCatalog(subject);
  const cols = opts.count
    ? "COUNT(*) AS count"
    : opts.columns?.length
      ? opts.columns.join(", ")
      : `${cat.alias}.id`;

  let tenantFilter = "";
  if (opts.tenantId) {
    c.params.push(opts.tenantId);
    tenantFilter = `${cat.alias}.tenant_id = $${c.params.length} AND `;
  }

  let sql = `SELECT ${cols} FROM ${cat.table} ${cat.alias} WHERE ${tenantFilter}${where}`;
  if (typeof opts.limit === "number") sql += ` LIMIT ${opts.limit}`;
  if (typeof opts.offset === "number") sql += ` OFFSET ${opts.offset}`;
  return { sql, params: c.params, joins: [] };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function toDuration(v: unknown): { amount: number; unit: "day" | "week" | "month" | "year" | "hour" | "minute" } {
  if (
    v &&
    typeof v === "object" &&
    "amount" in v &&
    "unit" in v
  ) {
    return v as any;
  }
  throw new Error(`Expected duration object {amount,unit}, got ${JSON.stringify(v)}`);
}

function intervalSql(d: { amount: number; unit: string }): string {
  const safe = String(d.amount).replace(/[^\d]/g, "");
  const unit = d.unit.replace(/[^a-z]/gi, "");
  if (!safe || !unit) throw new Error("Invalid duration");
  return `${safe} ${unit}`;
}

function renumberPlaceholders(sql: string, base: number): string {
  // $N becomes $(N+base)
  return sql.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + base}`);
}

/**
 * Bind a compiled `{ sql, params }` result into a Drizzle `sql` template that
 * properly parameterises every value.
 *
 * The compiler returns text with `$1, $2, …` placeholders + a `params` array.
 * Callers used to feed that directly into `sql.raw(text)` and drop the params,
 * which either crashed at runtime or — through the `intervalSql()` escape — let
 * a tenant-writable AST inject SQL via saved segments. This helper re-binds
 * every placeholder through Drizzle's tagged template so each value rides as a
 * proper bind parameter (no string interpolation, no escape gymnastics).
 *
 * Usage:
 *   const { sql: text, params } = compileToSelect(ast, "investor", { limit: 50 });
 *   const result = await tx.execute(bindCompiled(text, params));
 */
import { sql as dsql } from "drizzle-orm";
export function bindCompiled(text: string, params: unknown[]): ReturnType<typeof dsql> {
  const tokens: any[] = [];
  let lastEnd = 0;
  const re = /\$(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastEnd) tokens.push(dsql.raw(text.slice(lastEnd, match.index)));
    const idx = parseInt(match[1], 10) - 1;
    if (idx < 0 || idx >= params.length) {
      throw new Error(`bindCompiled: $${idx + 1} out of range (params length ${params.length})`);
    }
    tokens.push(params[idx]);
    lastEnd = match.index + match[0].length;
  }
  if (lastEnd < text.length) tokens.push(dsql.raw(text.slice(lastEnd)));
  return dsql.join(tokens, dsql``);
}
