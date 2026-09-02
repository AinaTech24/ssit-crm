/**
 * The RunContext is what action handlers see. It encapsulates:
 *   - tenant + run + step identity
 *   - the subject record (live snapshot — loaded by the runner)
 *   - run-scope variables (populated by triggers + earlier actions)
 *   - helpers to read/write context safely
 */

export interface RunContext {
  tenantId: string;
  runId: string;
  versionId: string;
  stepId: string;
  workflowId: string;
  /** The entity this run is bound to ('investor' | 'lead' | etc.) */
  subjectType: string | null;
  subjectId: string | null;
  /** Live snapshot of the subject record (refreshed at run start; may be re-fetched). */
  subject: Record<string, any> | null;
  /** Tenant record (for ARN, branding, etc. — used in template rendering) */
  tenant: Record<string, any>;
  /** Run-scope variables — accumulated over the life of the run */
  vars: Record<string, any>;
  /** The original event payload, if triggered by an event */
  event: Record<string, any> | null;
  /** Logger scoped to this run/step */
  log: (msg: string, meta?: Record<string, unknown>) => void;
}

/** Resolve a "vars.x" / "subject.y" / "tenant.z" / "event.w" / literal string expression. */
export function resolveExpression(expr: string, ctx: RunContext): unknown {
  if (!expr) return expr;
  if (!expr.includes(".") && !expr.includes("{{")) return expr; // literal

  // Mustache-style {{ ... }} replacement first
  if (expr.includes("{{")) {
    return expr.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, key) => {
      const v = resolveSinglePath(key.trim(), ctx);
      return v == null ? "" : String(v);
    });
  }
  return resolveSinglePath(expr, ctx);
}

function resolveSinglePath(path: string, ctx: RunContext): unknown {
  const [root, ...rest] = path.split(".");
  const map: Record<string, any> = {
    vars: ctx.vars,
    subject: ctx.subject ?? {},
    tenant: ctx.tenant,
    event: ctx.event ?? {},
  };
  let cur: any = map[root];
  if (cur === undefined) {
    // Treat as literal if not a known root
    return path;
  }
  for (const seg of rest) {
    if (cur == null) return null;
    cur = cur[seg];
  }
  return cur;
}

/** Resolve a record of values: { foo: "vars.x", bar: "literal" } */
export function resolveRecord(rec: Record<string, string>, ctx: RunContext): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    out[k] = resolveExpression(v, ctx);
  }
  return out;
}
