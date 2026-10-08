/**
 * "The admin ticked this module for this person" — as a PAGE-level fact.
 *
 * The sidebar already shows a module to anyone it was explicitly granted. But
 * the page behind it then ran its own capability check, and a role without the
 * matching capability got a crash page: the admin ticked Referrals, the item
 * appeared, and opening it threw. A tick is a decision about that person, so
 * the page honours it — with the data still cut down by the data wall (see
 * investorScopeSqlOrOwn), so a grant opens the door and never hands over
 * records the person could not otherwise see.
 *
 * Read from the DATABASE, like every other access input, so unticking bites on
 * the next request.
 */

import { sql } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import type { Capability } from "@/lib/auth/rbac";

export async function hasNavGrant(tx: any, session: SessionUser, href: string): Promise<boolean> {
  try {
    const r = await tx.execute(sql`
      SELECT enabled_modules FROM users
      WHERE id = ${session.userId}::uuid AND tenant_id = ${session.tenantId}::uuid LIMIT 1
    `);
    const raw = (r.rows[0] as { enabled_modules?: unknown } | undefined)?.enabled_modules;
    return Array.isArray(raw) && raw.includes(href);
  } catch {
    return false;
  }
}

/**
 * May this session open the page? Yes when it holds one of the capabilities, or
 * when an admin explicitly granted the sidebar item. Throws a 403 otherwise.
 */
export async function requireAnyOrNavGrant(
  tx: any,
  session: SessionUser,
  caps: Capability[],
  href: string
): Promise<void> {
  if (caps.some((c) => can(session.roles, c, session.permissions))) return;
  if (await hasNavGrant(tx, session, href)) return;
  throw Object.assign(new Error(`forbidden: missing one of ${caps.join(", ")}`), { status: 403 });
}
