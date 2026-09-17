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
 *   anyone with a branch grant       → every client in those branches
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
  dataScopeSql,
  resolveDataScope,
  assertInScope,
  applyScopeView,
  resolveScopeView,
  hasBranchView,
  type ScopeView,
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
export async function investorScopeCondition(tx: any, session: SessionUser, view?: ScopeView) {
  requireInvestorView(session);
  const scope = await resolveDataScope(tx, session);
  return dataScopeSql(
    view ? applyScopeView(scope, session.userId, view) : scope,
    INVESTOR_COLS("investors")
  );
}

/** Same rule as raw SQL, for queries built with sql`` fragments. */
export async function investorScopeSql(
  tx: any,
  session: SessionUser,
  alias = "investors",
  view?: ScopeView
) {
  requireInvestorView(session);
  const scope = await resolveDataScope(tx, session);
  return dataScopeSql(
    view ? applyScopeView(scope, session.userId, view) : scope,
    INVESTOR_COLS(alias)
  );
}

/**
 * The client list's "My clients / My branch" switch, resolved for this session.
 *
 * Returns the predicate to filter on, plus whether to render the switch at all
 * and which side it's on. Only a branch-scoped session has two sides — an RM
 * sees their own records either way, and an owner sees the firm.
 */
export async function investorListScope(
  tx: any,
  session: SessionUser,
  rawView: string | undefined
): Promise<{ condition: SQL; view: ScopeView; showSwitch: boolean }> {
  requireInvestorView(session);
  const scope = await resolveDataScope(tx, session);
  const view = resolveScopeView(rawView, session, scope);
  return {
    condition: dataScopeSql(applyScopeView(scope, session.userId, view), INVESTOR_COLS("investors")),
    view,
    showSwitch: hasBranchView(scope),
  };
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
  await assertInScope(
    tx,
    session,
    { branchId: inv.branchId, ownerId: [inv.rmId, inv.serviceRmId] },
    "client"
  );
}

/** Kept for callers that build their own `and(...)` chains. */
export { and, eq };
