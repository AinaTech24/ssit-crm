import { and, eq, sql } from "drizzle-orm";
import { leads } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import type { Tx } from "@/db/client";

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

/**
 * A branch head is scoped to their OWN branch — even though their role can
 * "view all", they only ever see their branch's pipeline. Only applies when a
 * branch is actually assigned to them (else they fall through to the normal
 * caps, so a mis-configured branch head is never locked out). Owner is never
 * branch-limited.
 */
export function isBranchScoped(session: SessionUser): boolean {
  return (
    !session.roles.includes("owner") &&
    session.roles.includes("branch_head") &&
    !!session.branchId
  );
}

export function leadScopeCondition(session: SessionUser) {
  requireLeadView(session);
  if (isBranchScoped(session)) return eq(leads.branchId, session.branchId!);
  if (canViewAllLeads(session)) return undefined;
  return eq(leads.ownerId, session.userId);
}

export function leadScopeSql(session: SessionUser, alias = "leads") {
  requireLeadView(session);
  if (isBranchScoped(session)) return sql`${sql.raw(`${alias}.branch_id`)} = ${session.branchId}::uuid`;
  if (canViewAllLeads(session)) return sql`TRUE`;
  return sql`${sql.raw(`${alias}.owner_id`)} = ${session.userId}::uuid`;
}

export async function loadEditableLead(tx: Tx, session: SessionUser, leadId: string) {
  requireLeadEdit(session);
  const [lead] = await tx.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.tenantId, session.tenantId))).limit(1);
  if (!lead) throw Object.assign(new Error("lead not found"), { status: 404 });
  if (isBranchScoped(session)) {
    if (lead.branchId === session.branchId) return lead;
    throw Object.assign(new Error("forbidden: lead is in another branch"), { status: 403 });
  }
  if (canEditAllLeads(session)) return lead;
  if (lead.ownerId === session.userId) return lead;
  throw Object.assign(new Error("forbidden: lead is not assigned to you"), { status: 403 });
}

export async function loadViewableLead(tx: Tx, session: SessionUser, leadId: string) {
  requireLeadView(session);
  const [lead] = await tx.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.tenantId, session.tenantId))).limit(1);
  if (!lead) return null;
  if (isBranchScoped(session)) return lead.branchId === session.branchId ? lead : null;
  if (canViewAllLeads(session) || lead.ownerId === session.userId) return lead;
  return null;
}
