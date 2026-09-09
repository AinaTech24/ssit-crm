/**
 * The single-Super-Admin rule.
 *
 * The firm runs exactly ONE Super Admin. `platform_admin` is the only role that
 * can mint other platform staff and reach every tenant's data, so it is a single
 * named accountable person, not a pool. The "Admin" tier (`platform_support`) is
 * unaffected — that is the role to hand out when someone else needs platform
 * access.
 *
 * There was already a LOWER bound (you cannot delete or demote the last Super
 * Admin — that would lock everyone out of /super-admin). This is the upper
 * bound, which nothing enforced: create, promote and re-activate could each
 * produce a second one.
 *
 * Counting ACTIVE holders only is what makes hand-over possible: suspend the
 * outgoing Super Admin, then promote the incoming one. A suspended Super Admin
 * cannot sign in, so they do not count against the limit.
 *
 * Deliberately NOT retrospective: an existing second Super Admin is left alone
 * rather than auto-demoted. Silently stripping someone's access is not a
 * migration's decision to make — the rule stops new ones, and the platform
 * admin can demote the extra themselves.
 */

import { sql } from "drizzle-orm";
import { PLATFORM_TENANT_ID } from "@/lib/platform";

/** Active Super Admins, optionally ignoring one user (the one being edited). */
export async function activeSuperAdminCount(tx: any, exceptId?: string): Promise<number> {
  const r = await tx.execute(
    exceptId
      ? sql`SELECT count(*)::int AS n FROM users
             WHERE tenant_id = ${PLATFORM_TENANT_ID}::uuid AND id <> ${exceptId}
               AND status = 'active' AND 'platform_admin' = ANY(roles)`
      : sql`SELECT count(*)::int AS n FROM users
             WHERE tenant_id = ${PLATFORM_TENANT_ID}::uuid
               AND status = 'active' AND 'platform_admin' = ANY(roles)`
  );
  return Number((r.rows[0] as { n?: number } | undefined)?.n ?? 0);
}

/**
 * Shown when a CREATE would make a second Super Admin.
 *
 * Note what it does NOT say: "suspend the current one first". That advice is a
 * dead end — the lower bound refuses to suspend the last active Super Admin,
 * and the upper bound refuses to promote a replacement while one is active, so
 * each guard tells you to do the other first and hand-over becomes impossible.
 * The way through is a transfer (see PATCH ?transfer), not a suspend.
 */
export const ONE_SUPER_ADMIN_MESSAGE =
  "There can only be one Super Admin. Create this person as an Admin, then use " +
  "Transfer Super Admin to move the role to them.";

/**
 * Shown when a PROMOTE would make a second. Points at the transfer, which is
 * the only thing that actually works.
 */
export const TRANSFER_SUPER_ADMIN_MESSAGE =
  "There is already a Super Admin. Moving the role to this person will demote the " +
  "current Super Admin to Admin — re-send with transferSuperAdmin: true to confirm.";

/**
 * Hand the single Super Admin seat over: demote every OTHER active Super Admin
 * to Admin. Runs in the caller's transaction so the firm is never briefly
 * without one, or briefly with two.
 *
 * Demotes rather than suspends: the outgoing person keeps platform access, they
 * just stop being the one accountable name. Locking someone out is a separate
 * decision, taken separately.
 */
export async function demoteOtherSuperAdmins(tx: any, exceptId: string): Promise<number> {
  const r = await tx.execute(sql`
    UPDATE users
       SET roles = ARRAY['platform_support']::text[], updated_at = now()
     WHERE tenant_id = ${PLATFORM_TENANT_ID}::uuid
       AND id <> ${exceptId}
       AND 'platform_admin' = ANY(roles)
    RETURNING id
  `);
  return r.rows.length;
}
