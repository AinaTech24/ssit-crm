/**
 * "Admin view" for someone who normally works inside one sub-branch.
 *
 * users.can_switch_admin (migration 0234) makes the switch AVAILABLE; the
 * `mfd_view_mode=admin` cookie is the person choosing to use it. getSession
 * calls `applyViewMode`, which adds the owner role to the session for that
 * request — so every page, API route and capability check below it sees a
 * proper firm admin, modules and data wall included, with no per-feature
 * special-casing.
 *
 * The flag is re-read from the database whenever the cookie is present, so
 * taking the permission away ends the elevated access on the next request
 * rather than whenever the cookie happens to expire.
 */

import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { SessionUser } from "./jwt";

export const VIEW_MODE_COOKIE = "mfd_view_mode";

export async function applyViewMode(session: SessionUser): Promise<SessionUser> {
  // Already a firm admin, or a platform session: nothing to elevate.
  if (session.roles.includes("owner") || session.isPlatformAdmin) return session;
  try {
    const c = await cookies();
    if (c.get(VIEW_MODE_COOKIE)?.value !== "admin") return session;
    const allowed = await withTenant(session.tenantId, async (tx) => {
      const r = await tx.execute(
        sql`SELECT can_switch_admin FROM users
             WHERE id = ${session.userId}::uuid AND tenant_id = ${session.tenantId}::uuid
             LIMIT 1`
      );
      return (r.rows[0] as { can_switch_admin?: boolean } | undefined)?.can_switch_admin === true;
    });
    if (!allowed) return session;
    // permissions: owner bypasses the custom allow-list anyway; clearing it
    // keeps the elevated session from reading as "customised".
    return { ...session, roles: [...session.roles, "owner"], permissions: undefined, viewMode: "admin" };
  } catch {
    // Outside a request context, or a pre-0234 database: stay as-is.
    return session;
  }
}

/** Does this user have the switch available? (layout / profile menu) */
export async function canSwitchAdmin(tenantId: string, userId: string): Promise<boolean> {
  try {
    return await withTenant(tenantId, async (tx) => {
      const r = await tx.execute(
        sql`SELECT can_switch_admin FROM users
             WHERE id = ${userId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1`
      );
      return (r.rows[0] as { can_switch_admin?: boolean } | undefined)?.can_switch_admin === true;
    });
  } catch {
    return false;
  }
}
