import { and, eq } from "drizzle-orm";
import { leads } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import type { Tx } from "@/db/client";
import {
  resolveSalesDataScope,
  dataScopeSqlViaOwnerBranch,
  isInScopeViaOwnerBranch,
} from "@/lib/auth/data-scope";

/**
 * Lead access.
 *
 * CAPABILITY answers "may this person work leads at all"; the DATA WALL in
 * lib/auth/data-scope.ts answers "which leads". They are separate on purpose —
 * holding lead.view.all no longer implies seeing the firm's pipeline, it means
 * you may view leads, within whatever the wall leaves you.
 */

export function requireLeadView(session: SessionUser) {
  requireAny(session.roles, ["lead.view.all", "lead.view.assigned"], session.permissions);
}

export function requireLeadEdit(session: SessionUser) {
  requireAny(session.roles, ["lead.edit.all", "lead.edit.assigned"], session.permissions);
}

export function canViewAllLeads(session: SessionUser) {
  return can(session.roles, "lead.view.all", session.permissions);
}

export function canEditAllLeads(session: SessionUser) {
  return can(session.roles, "lead.edit.all", session.permissions);
}

/** The columns the wall filters leads on. */
const LEAD_COLS = (alias: string) => ({
  branch: `${alias}.branch_id`,
  owner: `${alias}.owner_id`,
});

/**
 * Drizzle condition narrowing a lead query to what this session may see.
 *
 * Async because the wall reads the user's branch grant from the database —
 * deliberately not from the session token, so revoking a grant bites on the
 * next request rather than the next login.
 */
export async function leadScopeCondition(tx: Tx, session: SessionUser) {
  return leadScopeSql(tx, session, "leads");
}

/** Same rule for queries built from raw sql`` fragments. */
export async function leadScopeSql(tx: Tx, session: SessionUser, alias = "leads") {
  requireLeadView(session);
  // Branch scope is "owned by someone in my branch", derived from the OWNER's
  // current branch — not the lead's own branch_id column, which is stamped at
  // creation and drifts the moment a lead is reassigned or its owner moves
  // branch. Same rule as clients (lib/investors/access.ts).
  return dataScopeSqlViaOwnerBranch(await resolveSalesDataScope(tx, session), LEAD_COLS(alias).owner);
}

export async function loadEditableLead(tx: Tx, session: SessionUser, leadId: string) {
  requireLeadEdit(session);
  const [lead] = await tx
    .select()
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.tenantId, session.tenantId)))
    .limit(1);
  if (!lead) throw Object.assign(new Error("lead not found"), { status: 404 });
  const scope = await resolveSalesDataScope(tx, session);
  if (!(await isInScopeViaOwnerBranch(tx, scope, [lead.ownerId]))) {
    throw Object.assign(
      new Error("forbidden: this lead belongs to another branch or team member"),
      { status: 403 }
    );
  }
  return lead;
}

export async function loadViewableLead(tx: Tx, session: SessionUser, leadId: string) {
  requireLeadView(session);
  const [lead] = await tx
    .select()
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.tenantId, session.tenantId)))
    .limit(1);
  if (!lead) return null;
  const scope = await resolveSalesDataScope(tx, session);
  return (await isInScopeViaOwnerBranch(tx, scope, [lead.ownerId])) ? lead : null;
}
