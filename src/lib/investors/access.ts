/**
 * Client (investor) row-level access scope.
 *
 * RLS isolates by TENANT only — it does NOT slice a tenant's clients by who may
 * see them. That slice is the application's job, and it has to be applied in
 * EVERY query that returns a list of clients: the list page, the Excel export,
 * and the JSON API (which is also what the mobile app reads).
 *
 * The rule itself lives in ONE place — `lib/auth/data-scope.ts`. This module is
 * just the client-shaped adapter on top of it:
 *
 *   owner / back_office / ops        → the whole firm's book
 *   a branch head / branch grant     → every client whose RM sits in that
 *                                      branch (NOT the client's own stored
 *                                      branch column, which drifts)
 *   everyone else                    → clients assigned to them
 *
 * The capability gate is separate and still applies first: a role with no
 * client capability (marketing …) is blocked regardless of the wall.
 *
 * HISTORY — `tenants.restrict_user_data_scope` used to make this wall optional
 * per firm, defaulting to OFF, which meant that for most firms it did nothing
 * at all. The wall is now unconditional, so that switch is no longer consulted
 * here. `isDataScopeRestricted` is kept because other modules still read the
 * flag, but it no longer decides client visibility.
 *
 * Deliberately mirrors `lib/leads/access.ts`, which does the same job for the
 * pipeline.
 */

import { and, eq, sql, type SQL } from "drizzle-orm";
import { investors } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import {
  resolveDataScope,
  dataScopeSqlViaOwnerBranch,
  isInScopeViaOwnerBranch,
} from "@/lib/auth/data-scope";

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
 * The legacy per-tenant "restrict users to their own data" flag.
 *
 * No longer gates client visibility — the wall in lib/auth/data-scope.ts is
 * unconditional. Kept because it is still read elsewhere and because removing a
 * column mid-flight is a separate change.
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
 * The columns the wall filters clients on. Owner is BOTH the relationship RM
 * (rm_id) and the separate day-to-day servicing RM (service_rm_id, migration
 * 0209) — either one makes the client "yours". Missing this was a real
 * regression: since the wall shipped, a servicing RM who is not also the
 * relationship RM was invisible everywhere — list, export, every single-client
 * route — because only rm_id was checked.
 */
const INVESTOR_COLS = (alias: string) => ({
  branch: `${alias}.branch_id`,
  owner: [`${alias}.rm_id`, `${alias}.service_rm_id`],
});

/**
 * Drizzle condition restricting a client query to what this session may see.
 *
 * Always returns a condition now (never `undefined`) — an unrestricted session
 * gets a `TRUE` fragment, so callers can drop it into an `and(...)` without a
 * null check. Callers that still branch on falsiness keep working.
 */
export async function investorScopeCondition(tx: any, session: SessionUser) {
  requireInvestorView(session);
  return investorScopeSql(tx, session);
}

/** Same rule as raw SQL, for queries built with sql`` fragments. */
export async function investorScopeSql(tx: any, session: SessionUser, alias = "investors") {
  requireInvestorView(session);
  const cols = INVESTOR_COLS(alias);
  return dataScopeSqlViaOwnerBranch(await resolveDataScope(tx, session), cols.owner);
}

/**
 * Throws 403 unless this session may open THIS client's record.
 *
 * The single-row counterpart to `investorScopeCondition`, for routes that load
 * one client by id instead of listing many.
 *
 * Why it exists: the statement exports (PDF + Excel) checked only the
 * capability, which says the caller may view SOME clients and nothing about
 * which — so an RM could pull any client's holdings, amounts and PAN by
 * changing the id in the URL while the list was properly walled.
 *
 * Call INSIDE the tenant transaction, after loading the row.
 */
export async function assertCanViewClient(
  tx: any,
  session: SessionUser,
  inv: { rmId?: string | null; serviceRmId?: string | null; branchId?: string | null }
): Promise<void> {
  requireInvestorView(session);
  // Same rule as the list: visible if you own it, or if whoever owns it sits in
  // your branch. Checked against the OWNER's branch, not the client's stored
  // branch column, so the detail page can't disagree with the list.
  const scope = await resolveDataScope(tx, session);
  if (await isInScopeViaOwnerBranch(tx, scope, [inv.rmId, inv.serviceRmId])) return;
  throw Object.assign(
    new Error("forbidden: this client belongs to another branch or team member"),
    { status: 403 }
  );
}

/** Kept for callers that build their own `and(...)` chains. */
export { and, eq };
