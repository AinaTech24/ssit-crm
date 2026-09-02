import { type FilterAST, type Predicate, isGroup, isPredicate, type FieldRef } from "./ast";
import { getCatalog, getField, type FieldDef } from "./catalog";

/**
 * Compiles a FilterAST into a JavaScript predicate `(row) => boolean` for
 * single-record matching at event-arrival time. We don't query Postgres in
 * the hot path — we evaluate the AST in memory.
 *
 * The shape of `row` must match the catalog field paths:
 *   { investor: { name, aum, address: { city } }, transaction: { ... } }
 * Outbox events emit rich `before/after` payloads that already match this shape.
 */
export function compileToPredicate(
  ast: FilterAST,
  subject: string
): (row: Record<string, any>) => boolean {
  const cat = getCatalog(subject);
  return (row) => evalNode(ast, row, subject);

  function evalNode(node: FilterAST, row: Record<string, any>, subj: string): boolean {
    if (isGroup(node)) {
      const results = node.children.map((c) => evalNode(c, row, subj));
      let v: boolean;
      if (node.op === "AND") v = results.every(Boolean);
      else v = results.some(Boolean);
      return node.not ? !v : v;
    }
    if (isPredicate(node)) {
      return evalPredicate(node, row, subj);
    }
    return false;
  }
}

function evalPredicate(node: Predicate, row: Record<string, any>, subject: string): boolean {
  if (node.field.kind === "rel") {
    // Relations are not evaluable in-memory unless the event payload includes
    // related records. We treat unsupported as `false` rather than throw,
    // because some events may not include relations. The SQL path is authoritative.
    const related: any[] = getPath(row, node.field.rel);
    if (!Array.isArray(related)) return false;
    const childPredicate = compileToPredicate(node.field.predicate, subject);
    switch (node.field.quantifier) {
      case "any":
        return related.some(childPredicate);
      case "none":
        return !related.some(childPredicate);
      case "all":
        return related.every(childPredicate);
      case "count_gte":
        return related.filter(childPredicate).length >= (node.field.count ?? 0);
      case "count_lte":
        return related.filter(childPredicate).length <= (node.field.count ?? 0);
    }
  }

  const def = getField(subject, fieldKey(node.field));
  const value = getValueByField(row, node.field, def, subject);

  switch (node.op) {
    case "eq":
      return looseEq(value, node.value);
    case "ne":
      return !looseEq(value, node.value);
    case "gt":
      return num(value) > num(node.value);
    case "gte":
      return num(value) >= num(node.value);
    case "lt":
      return num(value) < num(node.value);
    case "lte":
      return num(value) <= num(node.value);
    case "contains":
      return str(value).toLowerCase().includes(str(node.value).toLowerCase());
    case "not_contains":
      return !str(value).toLowerCase().includes(str(node.value).toLowerCase());
    case "starts_with":
      return str(value).toLowerCase().startsWith(str(node.value).toLowerCase());
    case "ends_with":
      return str(value).toLowerCase().endsWith(str(node.value).toLowerCase());
    case "matches":
      try {
        return new RegExp(str(node.value)).test(str(value));
      } catch {
        return false;
      }
    case "in":
      return Array.isArray(node.value) && node.value.some((v) => looseEq(value, v));
    case "not_in":
      return !(Array.isArray(node.value) && node.value.some((v) => looseEq(value, v)));
    case "between": {
      const arr = node.value as [unknown, unknown];
      return num(value) >= num(arr[0]) && num(value) <= num(arr[1]);
    }
    case "not_between": {
      const arr = node.value as [unknown, unknown];
      return !(num(value) >= num(arr[0]) && num(value) <= num(arr[1]));
    }
    case "is_empty":
      return value == null || value === "";
    case "is_not_empty":
      return value != null && value !== "";
    case "is_null":
      return value == null;
    case "is_not_null":
      return value != null;
    case "is_true":
      return value === true;
    case "is_false":
      return value === false;
    case "date_today":
      return sameDay(asDate(value), new Date());
    case "date_yesterday": {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      return sameDay(asDate(value), y);
    }
    case "date_tomorrow": {
      const y = new Date();
      y.setDate(y.getDate() + 1);
      return sameDay(asDate(value), y);
    }
    case "date_is_anniversary": {
      const d = asDate(value);
      const n = new Date();
      return d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
    }
    case "date_within":
    case "date_in_last": {
      const d = asDate(value);
      const dur = node.duration ?? (node.value as any);
      const cutoff = subtractDuration(new Date(), dur);
      return d >= cutoff && d <= new Date();
    }
    case "date_in_next": {
      const d = asDate(value);
      const dur = node.duration ?? (node.value as any);
      const max = addDuration(new Date(), dur);
      return d >= new Date() && d <= max;
    }
    case "date_before":
      return asDate(value) < asDate(node.value);
    case "date_after":
      return asDate(value) > asDate(node.value);
    default: {
      const exhaustive: never = node.op;
      return false;
    }
  }
}

function fieldKey(field: FieldRef): string {
  if (field.kind === "attr") return field.path;
  if (field.kind === "computed") return field.key;
  throw new Error("Relation field has no key");
}

function getValueByField(row: Record<string, any>, field: FieldRef, _def: FieldDef, _subject: string): any {
  if (field.kind === "attr") {
    // Look at the dotted path against the row, but allow shorthand:
    // catalog.field key 'aum' looks at row.aum first, then row.<subject>.aum.
    const direct = getPath(row, field.path);
    if (direct !== undefined) return direct;
    return getPath(row, field.path); // simple — extend later
  }
  if (field.kind === "computed") {
    // Provide handy computed fallbacks. For everything else, the SQL path
    // is authoritative; in-memory predicates may return false.
    if (field.key === "days_since_last_contact" && row.last_contact_at) {
      return Math.floor((Date.now() - new Date(row.last_contact_at).getTime()) / 86_400_000);
    }
    if (field.key === "days_since_last_transaction" && row.last_transaction_at) {
      return Math.floor((Date.now() - new Date(row.last_transaction_at).getTime()) / 86_400_000);
    }
    if (field.key === "age_years" && row.dob) {
      const d = new Date(row.dob);
      const diff = Date.now() - d.getTime();
      return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
    }
    return getPath(row, field.key);
  }
  return undefined;
}

function getPath(obj: any, path: string): any {
  return path.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

function looseEq(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  // eslint-disable-next-line eqeqeq
  return a == b;
}
function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  if (v instanceof Date) return v.getTime();
  return NaN;
}
function str(v: unknown): string {
  return v == null ? "" : String(v);
}
function asDate(v: unknown): Date {
  if (v instanceof Date) return v;
  if (typeof v === "string" || typeof v === "number") return new Date(v);
  return new Date(NaN);
}
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function subtractDuration(d: Date, dur: { amount: number; unit: string }): Date {
  const n = new Date(d);
  switch (dur.unit) {
    case "day": n.setDate(n.getDate() - dur.amount); break;
    case "week": n.setDate(n.getDate() - dur.amount * 7); break;
    case "month": n.setMonth(n.getMonth() - dur.amount); break;
    case "year": n.setFullYear(n.getFullYear() - dur.amount); break;
    case "hour": n.setHours(n.getHours() - dur.amount); break;
    case "minute": n.setMinutes(n.getMinutes() - dur.amount); break;
  }
  return n;
}
function addDuration(d: Date, dur: { amount: number; unit: string }): Date {
  return subtractDuration(d, { ...dur, amount: -dur.amount });
}
