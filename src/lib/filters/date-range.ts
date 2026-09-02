/**
 * Date-range filter resolver — turns the FilterBar `date_range` params
 * (`<key>_from` / `<key>_to`, yyyy-mm-dd) into a parameterised SQL condition
 * for any list query. The `to` bound is inclusive of the whole day.
 *
 * `column` is a trusted column expression supplied by the call site (never
 * user input), so sql.raw is safe. Returns null when no range is set.
 *
 *   const conds = [];
 *   const d = dateRangeCond(sp, "created", "a.occurred_at");
 *   if (d) conds.push(d);
 */

import { sql, type SQL } from "drizzle-orm";

type SP = Record<string, string | undefined>;

export function dateRangeCond(sp: SP, key: string, column: string): SQL | null {
  const from = (sp[`${key}_from`] ?? "").trim();
  const to = (sp[`${key}_to`] ?? "").trim();
  const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  const col = sql.raw(column);
  const f = isDate(from) ? from : "";
  const t = isDate(to) ? to : "";
  if (f && t) return sql`${col} >= ${f}::date AND ${col} < (${t}::date + 1)`;
  if (f) return sql`${col} >= ${f}::date`;
  if (t) return sql`${col} < (${t}::date + 1)`;
  return null;
}

/** A ready-made FilterBar entry. */
export function dateRangeFilter(key = "created", label = "Date") {
  return { type: "date_range" as const, key, label };
}
