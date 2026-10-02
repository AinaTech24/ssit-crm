/**
 * Shared validation for the Announcements routes.
 *
 *  - audienceRolesSchema: target roles must be real tenant roles.
 *  - checkBranchTarget:   a branch target must belong to the tenant, and a
 *    non-owner manager (branch_head) may only target their own branch.
 */

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { branches, desks } from "@/db/schema";
import { ASSIGNABLE_ROLES } from "@/lib/auth/rbac";

const ASSIGNABLE = new Set<string>(ASSIGNABLE_ROLES);

/** audienceRoles must be real tenant roles (empty = visible to everyone). */
export const audienceRolesSchema = z
  .array(z.string())
  .max(12)
  .refine((rs) => rs.every((r) => ASSIGNABLE.has(r)), {
    message: "audienceRoles must be assignable tenant roles",
  });

/**
 * Enforce branch-targeting rules. Returns an error message, or null if OK.
 *   - any branchId must belong to THIS tenant;
 *   - a non-owner manager (branch_head) may only target their own branch
 *     (firm-wide `null` is still allowed).
 */
export async function checkBranchTarget(
  tx: Tx,
  opts: { branchId: string | null | undefined; tenantId: string; roles: string[]; ownBranchId: string | null }
): Promise<string | null> {
  if (!opts.branchId) return null; // firm-wide
  const isOwner = opts.roles.includes("owner");
  if (!isOwner && opts.branchId !== opts.ownBranchId) {
    return "branch heads can only post to their own branch or firm-wide";
  }
  const [br] = await tx
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.id, opts.branchId), eq(branches.tenantId, opts.tenantId)))
    .limit(1);
  return br ? null : "branch not found in this firm";
}

/**
 * A desk target must belong to the tenant, and a non-owner manager may only
 * target a desk inside their OWN branch — the same rule branch targeting
 * follows, so a branch head cannot address another branch's teams.
 */
export async function checkDeskTarget(
  tx: Tx,
  opts: { deskId: string | null | undefined; tenantId: string; roles: string[]; ownBranchId: string | null }
): Promise<string | null> {
  if (!opts.deskId) return null;
  const [d] = await tx
    .select({ id: desks.id, branchId: desks.branchId })
    .from(desks)
    .where(and(eq(desks.id, opts.deskId), eq(desks.tenantId, opts.tenantId)))
    .limit(1);
  if (!d) return "sub-branch not found in this firm";
  const isOwner = opts.roles.includes("owner");
  if (!isOwner && d.branchId && d.branchId !== opts.ownBranchId) {
    return "branch heads can only post to sub-branches in their own branch";
  }
  return null;
}
