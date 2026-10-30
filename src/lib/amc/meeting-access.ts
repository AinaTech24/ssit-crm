import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { users } from "@/db/schema";
import { can } from "@/lib/auth/rbac";
import type { SessionUser } from "@/lib/auth/session";

/**
 * The sidebar key an owner ticks (Employees → Sidebar Access) to give someone the
 * AMC Meetings dashboard.
 */
export const AMC_MEETINGS_NAV_KEY = "/dashboard/amc-meetings";

/**
 * Has an admin explicitly ticked "AMC Meetings" for this person?
 *
 * The tick is a single decision — "this person works AMC meetings" — so it
 * carries both halves: they see the dashboard and they can create a meeting. It
 * is read from the SAVED per-user grant (users.enabled_modules), never from role
 * defaults, so only a real tick counts. It does not reach AMC details
 * (amc_empanelment.*): trail rates and the escalation tree stay behind their own
 * capability.
 */
export async function hasAmcMeetingsNavGrant(session: SessionUser): Promise<boolean> {
  const [u] = await withTenant(session.tenantId, (tx) =>
    tx.select({ modules: users.enabledModules }).from(users).where(eq(users.id, session.userId)).limit(1)
  );
  const modules = (u?.modules as string[] | null) ?? null;
  return !!modules && modules.includes(AMC_MEETINGS_NAV_KEY);
}

/** What this person may do with AMC meetings: capability OR the sidebar tick. */
export async function amcMeetingAccess(session: SessionUser): Promise<{ view: boolean; add: boolean }> {
  const view = can(session.roles, "amc_meeting.view", session.permissions);
  const add = can(session.roles, "amc_meeting.add", session.permissions);
  if (view && add) return { view, add };
  const granted = await hasAmcMeetingsNavGrant(session);
  return { view: view || granted, add: add || granted };
}
