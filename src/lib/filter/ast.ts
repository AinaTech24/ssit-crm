import { z } from "zod";

/**
 * The FilterAST is the single, shared query language used by:
 *   - Saved views (investor list filtering, lead list filtering, etc.)
 *   - Dynamic segments (re-materialized on a schedule)
 *   - Workflow trigger criteria (`record_event` filters)
 *   - Workflow branch nodes (criteria evaluated mid-run)
 *   - AI assistant queries (Claude generates AST, we compile to SQL)
 *
 * The AST is intentionally restrictive: it only references fields declared in
 * `src/lib/filter/catalog.ts`. This is the line of defense against SQL
 * injection — values are always parameterized, fields are looked up by key.
 */

export const FilterOperatorSchema = z.enum([
  // Equality / comparison
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  // String matching
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "matches", // regex (compiled safely)
  // Set membership
  "in",
  "not_in",
  // Range
  "between",
  "not_between",
  // Empties / nulls
  "is_empty",
  "is_not_empty",
  "is_null",
  "is_not_null",
  "is_true",
  "is_false",
  // Date helpers (relative)
  "date_within", // "within last N <unit>"
  "date_before", // "before N <unit> ago" / "before a specific date"
  "date_after", // "after N <unit> ago" / "after a specific date"
  "date_today",
  "date_yesterday",
  "date_tomorrow",
  "date_in_next", // "in next N <unit>"
  "date_in_last", // "in last N <unit>"
  "date_is_anniversary", // month-day matches today (birthdays, anniversaries)
]);

export type FilterOperator = z.infer<typeof FilterOperatorSchema>;

/** A reference to a field. */
export const FieldRefSchema: z.ZodType<FieldRef> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("attr"), path: z.string() }),
    z.object({
      kind: z.literal("rel"),
      rel: z.string(),
      predicate: FilterASTSchema,
      quantifier: z.enum(["any", "all", "none", "count_gte", "count_lte"]).default("any"),
      count: z.number().int().optional(),
    }),
    z.object({ kind: z.literal("computed"), key: z.string() }),
  ])
);

export type FieldRef =
  | { kind: "attr"; path: string }
  | {
      kind: "rel";
      rel: string;
      predicate: FilterAST;
      quantifier?: "any" | "all" | "none" | "count_gte" | "count_lte";
      count?: number;
    }
  | { kind: "computed"; key: string };

/** A leaf comparison. */
export const PredicateSchema: z.ZodType<Predicate> = z.lazy(() =>
  z.object({
    type: z.literal("predicate"),
    field: FieldRefSchema,
    op: FilterOperatorSchema,
    value: z.unknown().optional(),
    /** For `date_within` etc. */
    duration: z
      .object({
        amount: z.number().int().nonnegative(),
        unit: z.enum(["day", "week", "month", "year", "hour", "minute"]),
      })
      .optional(),
  })
);

export type Predicate = {
  type: "predicate";
  field: FieldRef;
  op: FilterOperator;
  value?: unknown;
  duration?: { amount: number; unit: "day" | "week" | "month" | "year" | "hour" | "minute" };
};

/** A nested AND/OR group. */
export const GroupSchema: z.ZodType<Group> = z.lazy(() =>
  z.object({
    type: z.literal("group"),
    op: z.enum(["AND", "OR"]),
    not: z.boolean().optional(),
    children: z.array(FilterASTSchema).max(64),
  })
);

export type Group = {
  type: "group";
  op: "AND" | "OR";
  not?: boolean;
  children: FilterAST[];
};

// NOTE: must be z.union, NOT z.discriminatedUnion. The two members are z.lazy()
// wrappers (required for the recursive forward-reference — Group.children and a
// rel-predicate's field both contain FilterASTs). z.discriminatedUnion reads the
// discriminator literal off each option's ZodObject shape, which a ZodLazy does
// not expose — so it throws "Cannot read properties of undefined (reading 'type')"
// at parse time (this broke the AI smart-search for every provider). z.union
// tries each member in order and handles lazy schemas correctly.
export const FilterASTSchema: z.ZodType<FilterAST> = z.lazy(() =>
  z.union([GroupSchema, PredicateSchema])
);

export type FilterAST = Group | Predicate;

export function isGroup(node: FilterAST): node is Group {
  return node.type === "group";
}
export function isPredicate(node: FilterAST): node is Predicate {
  return node.type === "predicate";
}

/** Max nesting depth allowed for a filter. Bounds compile recursion + SQL size. */
export const MAX_AST_DEPTH = 12;

/**
 * Structural depth of an AST — counts group nesting AND relation-predicate
 * nesting (each `rel` predicate compiles to a correlated subquery). Used to
 * reject pathologically deep filters before they explode into huge SQL or
 * deep compiler recursion.
 */
export function astDepth(node: FilterAST, depth = 1): number {
  if (depth > 200) return depth; // hard stop — never recurse unbounded
  let max = depth;
  if (isGroup(node)) {
    for (const c of node.children) {
      const d = astDepth(c, depth + 1);
      if (d > max) max = d;
    }
  } else if (isPredicate(node) && node.field.kind === "rel") {
    const d = astDepth(node.field.predicate, depth + 1);
    if (d > max) max = d;
  }
  return max;
}

/** Build helpers — make tests and recipe authoring nicer. */
export const and = (...children: FilterAST[]): Group => ({
  type: "group",
  op: "AND",
  children,
});
export const or = (...children: FilterAST[]): Group => ({
  type: "group",
  op: "OR",
  children,
});
export const not = (g: Group): Group => ({ ...g, not: true });
export const p = (
  field: string | FieldRef,
  op: FilterOperator,
  value?: unknown,
  duration?: Predicate["duration"]
): Predicate => ({
  type: "predicate",
  field: typeof field === "string" ? { kind: "attr", path: field } : field,
  op,
  value,
  duration,
});
