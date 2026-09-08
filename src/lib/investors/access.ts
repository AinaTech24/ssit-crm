/**
 * Client (investor) row-level access scope.
 *
 * RLS isolates by TENANT only — it does NOT slice a tenant's clients by who may
 * see them. That slice is the application's job, and it has to be applied in
 * EVERY query that returns a list of clients: the list page, the Excel export,
 * and the JSON API (which is also what the mobile app reads).
 *
 * Whether the slice applies at all is a PER-TENANT switch —
 * `tenants.restrict_user_data_scope`, default FALSE. Some firms run a shared
 * book where every RM serves every client; others need a hard wall between
 * books. Default-off means no existing firm's visibility changes until its
 * owner (or platform admin) deliberately turns the wall on.
 *
 * When the switch is ON (mirrors the capability matrix in lib/auth/rbac.ts):
 *   owner / compliance / back_office / ops  → the whole firm's book
 *   branch_head (with a branch)             → their branch only
 *   rm                                      → clients assigned to them
 *
 * When it is OFF every role that may view clients at all sees the whole book.
 * The capability gate is NOT part of the switch: a role with no client
 * capability (marketing …) is blocked either way, as the API has always done.
 *
 * Deliberately mirrors `lib/leads/access.ts`, which does the same job for the
 * pipeline. NOTE: lead scoping is unconditional and predates this switch —
 * turning this off does not widen lead visibility.
 */

import { eq, sql } from "drizzle-orm";
import { investors } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
// Session-level helper — its canonical home is the leads access module (its
// first caller). Branch scoping is identical for clients and leads.
import { isBranchScoped } from "@/lib/leads/access";

/** Throws 403 when the caller has no client visibility at all. */
export function requireInvestorView(session: SessionUser) {
  requireAny(
    session.roles,
    ["investor.view.all", "investor.view.assigned"],
    session.permissions
  );
}

export function canViewAllInvestors(session: SessionUser) {
  return can(session.roles, "investor.view.all", session.permissions);
}

/**
 * Is the per-tenant data wall switched on? Read inside the CALLER's existing
 * transaction so it costs one cheap indexed read and needs no second pool
 * connection (every call site is already inside withTenant). Unreadable or
 * missing → false, i.e. fail OPEN to the long-standing firm-wide behaviour
 * rather than hiding a firm's own clients from it on a transient error.
 */
export async function isDataScopeRestricted(tx: any, tenantId: string): Promise<boolean> {
  try {
    const r = await tx.execute(sql`
      SELECT restrict_user_data_scope AS on FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1
    `);
    return (r.rows[0] as { on?: boolean } | undefined)?.on === true;
  } catch {
    return false;
  }
}

/**
 * Drizzle condition restricting a client query to what this session may see.
 * `undefined` means "no restriction" — either the tenant has the switch off or
 * the caller is a firm-wide viewer — so callers can drop it into an `and(...)`
 * without an extra branch.
 */
export async function investorScopeCondition(tx: any, session: SessionUser) {
  requireInvestorView(session);
  if (!(await isDataScopeRestricted(tx, session.tenantId))) return undefined;
  if (isBranchScoped(session)) return eq(investors.branchId, session.branchId!);
  if (canViewAllInvestors(session)) return undefined;
  return eq(investors.rmId, session.userId);
}

/**
 * Same rule as raw SQL, for queries built with sql`` fragments rather than the
 * query builder. Returns `TRUE` when unrestricted so it can be joined into an
 * AND chain unconditionally.
 */
export async function investorScopeSql(tx: any, session: SessionUser, alias = "investors") {
  requireInvestorView(session);
  if (!(await isDataScopeRestricted(tx, session.tenantId))) return sql`TRUE`;
  if (isBranchScoped(session)) {
    return sql`${sql.raw(`${alias}.branch_id`)} = ${session.branchId}::uuid`;
  }
  if (canViewAllInvestors(session)) return sql`TRUE`;
  return sql`${sql.raw(`${alias}.rm_id`)} = ${session.userId}::uuid`;
}

/**
 * Throws 403 unless this session may open THIS client's record.
 *
 * The single-row counterpart to `investorScopeCondition`, for routes that load
 * one client by id instead of listing many. It honours the SAME per-tenant
 * switch, so a firm running a shared book is unaffected and a firm that has
 * turned the wall on gets it enforced here too.
 *
 * Why it exists: the statement exports (PDF + Excel) checked only the
 * capability, which says the caller may view SOME clients and nothing about
 * which. With the wall on, an RM could still have pulled any client's holdings,
 * amounts and PAN by changing the id in the URL — the list was walled and the
 * export was not.
 *
 * Call INSIDE the tenant transaction, after loading the row.
 */
export async function assertCanViewClient(
  tx: any,
  session: SessionUser,
  inv: { rmId?: string | null; branchId?: string | null }
): Promise<void> {
  requireInvestorView(session);
  if (!(await isDataScopeRestricted(tx, session.tenantId))) return;
  if (canViewAllInvestors(session)) return;
  if (isBranchScoped(session)) {
    if (inv.branchId !== session.branchId) {
      throw Object.assign(new Error("forbidden: client is in another branch"), { status: 403 });
    }
    return;
  }
  if (inv.rmId !== session.userId) {
    throw Object.assign(new Error("forbidden: client not assigned to you"), { status: 403 });
  }
}
